# `transom pull` and `transom mend`: sourced by bin/transom, not run, with $verb
# set and the arguments after it. Both name a post by the path `post` printed,
# and both go through the daemon — over loopback here, with the token from a node.

fail() { echo "transom $verb: $1" >&2; exit 1; }

. "$TRANSOM_HOME/libexec/sidecar.sh"

transom_root="${TRANSOM_ROOT:-$HOME/transom}"
. "$TRANSOM_HOME/libexec/remote.sh"
session=${CLAUDE_CODE_SESSION_ID:-}

case "${1:-}" in
  ""|-*) fail "takes the path \`transom post\` printed" ;;
esac
path=$1
shift

words=""
add_word() { words="$words${words:+,}\"$1\":\"$(json_escape "$2")\""; }
file=""
while [ $# -gt 0 ]; do
  case "$1" in
    --caption|--note|--attention)
      [ "$verb" = mend ] || fail "$1 belongs to \`transom mend\`"
      [ $# -gt 1 ] || fail "$1 takes a value; \"\" clears it"
      add_word "${1#--}" "$2"; shift 2 ;;
    -?*) fail "no such flag: $1" ;;
    *)
      [ "$verb" = mend ] || fail "takes one path"
      [ -z "$file" ] || fail "takes one file"
      [ -f "$1" ] || fail "no such file: $1"
      file=$1; shift ;;
  esac
done
if [ "$verb" = mend ] && [ -z "$file" ] && [ -z "$words" ]; then
  fail "nothing to mend: give a file, --caption, --note or --attention"
fi

ext_of() {
  e="${1##*.}"
  case "$e" in "$1") e="" ;; esac
  printf '%s' "$e" | tr 'A-Z' 'a-z'
}
if [ -n "$file" ] && [ "$(ext_of "$file")" != "$(ext_of "$path")" ]; then
  fail "the card holds a .$(ext_of "$path"), not a .$(ext_of "$file"): pull it and post the new one"
fi

if remote_on; then
  remote_load
  base=$TRANSOM_WALL
else
  # Loopback needs no token, only the protocol every route here checks.
  remote_tmp=$(umask 077 && mktemp -d "${TMPDIR:-/tmp}/transom-posts.XXXXXX")
  trap remote_clean EXIT
  printf 'X-Transom-Protocol: %s\n' "$TRANSOM_PROTOCOL" > "$remote_tmp/headers"
  base="http://localhost:${TRANSOM_PORT:-8787}"
fi

query=$(printf '%s' "$path" | od -An -tx1 | tr -d ' \n' | sed 's/../%&/g')
body="$remote_tmp/reply"
set -- -o "$body" -w '%{http_code}' -X POST
if [ "$verb" = mend ]; then
  set -- "$@" -H "X-Transom-Sidecar: $(printf '{%s}' "$words" | base64 | tr -d '\n')"
  if [ -n "$file" ]; then
    set -- "$@" --speed-limit 1 --speed-time 30 -H "X-Transom-Name: .$(ext_of "$file")" -T "$file"
  fi
fi
rc=0
code=$(remote_curl "$@" "$base/api/posts/$verb?path=$query" 2>"$remote_tmp/err") || rc=$?
case "$rc" in
  0) ;;
  6|7|28)
    echo "transom $verb: the wall at $base is not answering" >&2
    exit 6 ;;
  *)
    echo "transom $verb: $(sed 's/^curl: //' "$remote_tmp/err") (HTTP $code)" >&2
    exit 1 ;;
esac
[ "$code" = 200 ] || remote_refused "$code" "$body"
[ "$verb" = mend ] && echo "$path"
exit 0
