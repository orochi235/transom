# Remote mode for bin/transom: sourced, not run. On when $transom_root/wall.env
# exists, which `transom pair` writes from the wall host.

TRANSOM_PROTOCOL=1

remote_on() { [ -f "$transom_root/wall.env" ]; }

remote_load() {
  # shellcheck disable=SC1091
  . "$transom_root/wall.env"
  [ -n "${TRANSOM_WALL:-}" ] && [ -n "${TRANSOM_TOKEN:-}" ] || fail "wall.env names no wall or no token. Run transom pair on the wall host."
}

remote_curl() {
  curl -sS --connect-timeout 3 \
    -H "Authorization: Bearer $TRANSOM_TOKEN" \
    -H "X-Transom-Protocol: $TRANSOM_PROTOCOL" "$@"
}

# FILE (or - for stdin), the name suffix, the zone, the sidecar JSON. Prints the
# path the wall host gave it.
remote_send() {
  side=$(printf '%s' "$4" | base64 | tr -d '\n')
  body=$(mktemp "${TMPDIR:-/tmp}/transom-reply.XXXXXX")
  code=$(remote_curl -o "$body" -w '%{http_code}' \
    -H "X-Transom-Name: $2" -H "X-Transom-Sidecar: $side" \
    --data-binary "@$1" "$TRANSOM_WALL/api/inbox/$3") || code=000
  if [ "$code" = 000 ]; then
    rm -f "$body"
    echo "transom $verb: the wall at $TRANSOM_WALL is not answering" >&2
    exit 6
  fi
  if [ "$code" != 200 ]; then
    cat "$body" >&2; rm -f "$body"; exit 1
  fi
  sed -n 's/.*"path":"\([^"]*\)".*/\1/p' "$body"
  rm -f "$body"
}

# Long-polls for the answer to NAME and writes it to DEST, where await_answer
# reads it as though the local daemon had. A wall that has gone away is waited
# out: a question can outlast a laptop lid.
remote_await() {
  mkdir -p "$(dirname "$2")"
  while :; do
    code=$(remote_curl -m 40 -o "$2.part" -w '%{http_code}' "$TRANSOM_WALL/api/answers/$1?wait=30") || code=000
    case "$code" in
      200) mv "$2.part" "$2"; return 0 ;;
      204) rm -f "$2.part" ;;
      000) rm -f "$2.part"; sleep 2 ;;
      *) cat "$2.part" >&2; rm -f "$2.part"; exit 1 ;;
    esac
  done
}
