# Remote mode for bin/transom: sourced, not run. On when $transom_root/wall.env
# exists, which `transom pair` writes from the wall host.

TRANSOM_PROTOCOL=1

# The base64 sidecar rides in a header, and the daemon's HTTP server refuses a
# header block much past 16 KB with a reset rather than a status.
REMOTE_SIDECAR_MAX=12000

remote_on() { [ -f "$transom_root/wall.env" ]; }

remote_clean() { [ -n "${remote_tmp:-}" ] && rm -rf "$remote_tmp"; return 0; }

remote_load() {
  # shellcheck disable=SC1091
  . "$transom_root/wall.env"
  [ -n "${TRANSOM_WALL:-}" ] && [ -n "${TRANSOM_TOKEN:-}" ] || fail "wall.env names no wall or no token. Run transom pair on the wall host."
  # The token goes to curl from a file: in argv, `ps` shows it for as long as an
  # ask waits.
  remote_tmp=$(umask 077 && mktemp -d "${TMPDIR:-/tmp}/transom-remote.XXXXXX")
  trap remote_clean EXIT
  trap 'remote_clean; trap - INT; kill -INT $$' INT
  trap 'remote_clean; trap - TERM; kill -TERM $$' TERM
  printf 'Authorization: Bearer %s\nX-Transom-Protocol: %s\n' "$TRANSOM_TOKEN" "$TRANSOM_PROTOCOL" > "$remote_tmp/headers"
}

remote_curl() {
  curl -sS --connect-timeout 3 -H "@$remote_tmp/headers" "$@"
}

remote_refused() {
  if [ -s "$2" ]; then
    echo "transom $verb: the wall refused this (HTTP $1): $(cat "$2")" >&2
  else
    echo "transom $verb: the wall refused this (HTTP $1)" >&2
  fi
  exit 1
}

# FILE (or - for stdin), the name suffix, the zone, the sidecar JSON. Prints the
# path the wall host gave it.
remote_send() {
  case "$3" in
    ""|*[!A-Za-z0-9._-]*) fail "a remote wall takes a zone of letters, digits, '.', '_' and '-' ($3)" ;;
  esac
  side=$(printf '%s' "$4" | base64 | tr -d '\n')
  if [ ${#side} -gt $REMOTE_SIDECAR_MAX ]; then
    fail "the card's text is too long to send to a remote wall (${#side} bytes, $REMOTE_SIDECAR_MAX at most) — shorten --note, --question, --why or --caption"
  fi
  body="$remote_tmp/reply"
  rc=0
  code=$(remote_curl -o "$body" -w '%{http_code}' \
    -H "X-Transom-Name: $2" -H "X-Transom-Sidecar: $side" \
    --data-binary "@$1" "$TRANSOM_WALL/api/inbox/$3" 2>"$remote_tmp/err") || rc=$?
  case "$rc" in
    0) ;;
    6|7|28)
      echo "transom $verb: the wall at $TRANSOM_WALL is not answering" >&2
      exit 6 ;;
    *)
      echo "transom $verb: $(sed 's/^curl: //' "$remote_tmp/err") (HTTP $code)" >&2
      exit 1 ;;
  esac
  [ "$code" = 200 ] || remote_refused "$code" "$body"
  path=$(sed -n 's/.*"path":"\([^"]*\)".*/\1/p' "$body")
  rm -f "$body"
  [ -n "$path" ] || fail "the wall answered without a path"
  printf '%s\n' "$path"
}

# Long-polls for the answer to NAME and writes it to DEST, where await_answer
# reads it as though the local daemon had. A wall that has gone away is waited
# out: a question can outlast a laptop lid.
remote_await() {
  mkdir -p "$(dirname "$2")"
  part="$remote_tmp/answer"
  while :; do
    code=$(remote_curl -m 40 -o "$part" -w '%{http_code}' "$TRANSOM_WALL/api/answers/$1?wait=30" 2>/dev/null) || code=000
    case "$code" in
      200) mv "$part" "$2"; return 0 ;;
      204) rm -f "$part" ;;
      000) rm -f "$part"; sleep 2 ;;
      *) remote_refused "$code" "$part" ;;
    esac
  done
}
