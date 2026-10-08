# `transom post`, `ask`, `wait` and `zone`: sourced by bin/transom, not run,
# with $verb set and the arguments after it.

# What the wall holds, matching server/kind.ts — held to it by kind.test.ts.
# Anything else is never adopted, so accepting it here would produce exactly the
# silently invisible artifact the ingest contract exists to prevent.
held_ext="png jpg jpeg webp gif avif tiff svg html htm mp4 m4v mov webm glb stl"
# Of those, the ones the daemon needs ffmpeg to turn into a poster frame. A
# video sent to a machine without it would be adopted by nothing and expired by
# nothing either, which is the silently invisible artifact this check exists to
# prevent — the same reason the extension check is here and not at ingest.
video_ext="mp4 m4v mov webm"

fail() { echo "transom $verb: $1" >&2; exit 1; }

. "$TRANSOM_HOME/libexec/sidecar.sh"
. "$TRANSOM_HOME/libexec/answer.sh"

# What the free-text box says when `--why` is bare. Here rather than in the
# wall so that the sidecar always carries the words: a placeholder the daemon
# filled in would change under an artifact already hanging.
WHY_DEFAULT="anything to add?"

question=""
if [ "$verb" = ask ]; then
  case "${1:-}" in
    ""|--*) fail 'the question comes first: transom ask "which reads better?" FILE' ;;
  esac
  question=$1
  shift
fi

# A flag that only means something beside a question.
asking() { [ "$verb" = ask ] || fail "$1 belongs to \`transom ask\`"; }

zone=""
ttl=""
caption=""
attention=""
note=""
sandbox=""
choices=""
why=""
group=""
group_label=""
of=""
apps=""
links=""
as_json=""
no_wait=""
[ -n "${TRANSOM_ZONE:-}" ] && zone="$TRANSOM_ZONE"
while :; do
  case "${1:-}" in
    --zone) zone="$2"; shift 2 ;;
    --ttl) ttl="$2"; shift 2 ;;
    --caption) caption="$2"; shift 2 ;;
    --attention) attention="$2"; shift 2 ;;
    --note) note="$2"; shift 2 ;;
    --sandbox) sandbox="$2"; shift 2 ;;
    --choice) asking --choice; choices="$choices${choices:+,}\"$(json_escape "$2")\""; shift 2 ;;
    # Optional value: bare at the end of the arguments, before another flag, or
    # before the file it is sending. A placeholder is a sentence and a file is a
    # path, so the one that exists on disk is the one that is not the prompt.
    --why)
      asking --why
      if [ $# -gt 1 ] && [ -n "${2:-}" ] && [ "${2#-}" = "$2" ] && [ ! -f "$2" ]; then
        why="$2"; shift 2
      else
        why="$WHY_DEFAULT"; shift
      fi ;;
    --group|--run) group="$2"; shift 2 ;;
    --group-label|--run-label) group_label="$2"; shift 2 ;;
    --of) of="$2"; shift 2 ;;
    --app) apps="$apps$2
"; shift 2 ;;
    --link) links="$links${links:+,}$(link_json "$2")"; shift 2 ;;
    --json) [ "$verb" = wait ] || asking --json; as_json=1; shift ;;
    --no-wait) asking --no-wait; no_wait=1; shift ;;
    --) shift; break ;;
    -?*) fail "no such flag: $1" ;;
    *) break ;;
  esac
done
# The main checkout, not the worktree: an agent worktree is named for its own
# hash and carries no untracked `.hued`, so sending from one both invented a
# zone called `agent-a4ac2473…` and cost the real zone its color.
root=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
case "$root" in
  */.git) root=${root%/.git} ;;
  *) root=$(git rev-parse --show-toplevel 2>/dev/null || pwd) ;;
esac
repo=$(basename "$root")
sha=$(git rev-parse --short HEAD 2>/dev/null || true)

# The repo's own settings. A flag beats the file, so each only fills a blank.
file_zone="" file_show="" file_ttl="" file_apps="" file_quiet=""
if [ -f "$root/.transom.yaml" ]; then
  settings=$(node "$TRANSOM_HOME/libexec/settings.mjs" "$root/.transom.yaml" "$root" "$attention") || exit 1
  eval "$settings"
fi
[ -z "$zone" ] && zone=$file_zone
[ -z "$ttl" ] && ttl=$file_ttl
[ -z "$apps" ] && apps=$file_apps
quiet=$file_quiet

# A dot-segment before the extension, which is where the daemon looks.
# Not `[ -n ... ] && ...`: that returns non-zero when unset, and set -e exits.
suffix=""
if [ -n "$ttl" ]; then suffix=".ttl$ttl"; fi

# The Claude Code session this runs under, where there is one: a drawing sent
# back from the wall goes to it, and the pid is how the daemon tells whether it
# is still running. A pid that is not a number is not written.
session=${CLAUDE_CODE_SESSION_ID:-}
pid=${CLAUDE_PID:-}
case "$pid" in ""|*[!0-9]*) pid="" ;; esac
if [ -z "$zone" ]; then
  # printf, not a bare pipe: tr -c would turn basename's trailing newline into a
  # separator character and silently bind the repo to a second, adjacent zone.
  zone=$(printf '%s' "$repo" | tr -c 'A-Za-z0-9._-' '-')
fi

if [ "$verb" = zone ]; then echo "$zone"; exit 0; fi

if [ "$file_show" = preview ] && [ "$verb" != wait ]; then
  [ "$verb" = post ] || fail "this repo opens renders in Preview (.transom.yaml), so there is no card to ask on"
  if [ $# -eq 0 ]; then
    [ -t 0 ] && fail "no file, and nothing piped in"
    piped="${TMPDIR:-/tmp}/transom-$(uuidgen).png"
    cat > "$piped"
    set -- "$piped"
  fi
  for f in "$@"; do [ -f "$f" ] || fail "no such file: $f"; done
  ${TRANSOM_OPEN:-open} "$@"
  exit 0
fi

ext_of() {
  e="${1##*.}"
  case "$e" in "$1") e=png ;; esac
  printf '%s' "$e" | tr 'A-Z' 'a-z'
}

transom_root="${TRANSOM_ROOT:-$HOME/transom}"
. "$TRANSOM_HOME/libexec/remote.sh"
case "$verb" in post|ask|wait) if remote_on; then remote_load; fi ;; esac

if [ "$verb" = wait ]; then
  [ $# -eq 1 ] || fail "takes the path \`transom ask --no-wait\` printed"
  await_answer "$1"
fi
# A group answers per take, so several files are several answers and the caller
# waits on the paths this printed. Without one, one send is one answer.
if [ -n "$question" ] && [ -z "$group" ] && [ $# -gt 1 ]; then
  fail "takes one file, since one answer comes back"
fi
if [ -n "$group_label" ] && [ -z "$group" ]; then fail "--group-label needs --group"; fi
if [ -n "$of" ] && [ -z "$group" ]; then fail "--of needs --group"; fi
if [ -n "$of" ]; then
  case "$of" in *[!0-9]*|0) fail "--of takes a count of takes ($of)" ;; esac
fi
# With no file this reads stdin, and at a terminal that is a command that
# hangs without saying what it is waiting for.
if [ $# -eq 0 ] && [ -t 0 ]; then fail "no file, and nothing piped in"; fi
dir="$transom_root/inbox/$zone"

# The session marker the hook reads to know this session's sends live on
# another host.
remote_sent() {
  [ -n "$session" ] || return 0
  mkdir -p "$transom_root/remote-sessions"
  : > "$transom_root/remote-sessions/$(printf '%s' "$session" | tr -c 'A-Za-z0-9._-' '_')"
}

if ! remote_on; then
  mkdir -p "$dir"
  # Where this zone's renders come from, so the daemon can find the project's
  # `.hued` and color the zone. One file per zone, rewritten on every send: a
  # shared registry would be a read-modify-write that two concurrent sends lose.
  zones_dir="$transom_root/zones"
  mkdir -p "$zones_dir"
  tmp="$zones_dir/.$zone.$$"
  printf '{"root":"%s"}\n' "$(json_escape "$root")" > "$tmp" && mv "$tmp" "$zones_dir/$zone.json"
fi

if [ $# -eq 0 ]; then
  if remote_on; then
    dest=$(remote_send - "$suffix.png" "$zone" "$(sidecar_json - "$caption")")
    echo "$dest"
    remote_sent
  else
    dest="$dir/$(uuidgen)$suffix.png"
    write_sidecar "$dest" "$caption"
    cat > "$dest"
    echo "$dest"
  fi
  [ -n "$question" ] && [ -z "$no_wait" ] && await_answer "$dest"
  exit 0
fi

# A whole pass before the first copy, so a bad argument at the end of the list
# cannot leave the earlier ones half-sent.
for f in "$@"; do
  [ -f "$f" ] || fail "no such file: $f"
  ext=$(ext_of "$f")
  # Named ahead of the general refusal: a .gltf is the one unheld extension
  # somebody sends on purpose, and "the wall does not hold it" would not say why.
  if [ "$ext" = "gltf" ]; then
    fail "a .gltf points at sibling files this send does not carry ($f). Export a .glb."
  fi
  case " $held_ext " in
    *" $ext "*) ;;
    *) fail "the wall does not hold .$ext ($f). It holds: $held_ext" ;;
  esac
  case " $video_ext " in
    *" $ext "*)
      remote_on || command -v ffmpeg >/dev/null 2>&1 ||
        fail ".$ext needs ffmpeg for the poster frame ($f). brew install ffmpeg" ;;
  esac
done

for f in "$@"; do
  ext=$(ext_of "$f")
  dest="$dir/$(uuidgen)$suffix.$ext"
  # The destination name is a UUID, so without this the source name — the only
  # caption most renders have — is lost at the copy.
  if [ -n "$caption" ]; then
    own=$caption
  else
    own=$(basename "$f"); own="${own%.*}"
  fi
  if remote_on; then
    dest=$(remote_send "$f" "$suffix.$ext" "$zone" "$(sidecar_json "$f" "$own")")
    echo "$dest"
    remote_sent
  else
    write_sidecar "$dest" "$own"
    cp "$f" "$dest"
    echo "$dest"
  fi
  # An if, not `[ -n ... ] &&`: as the loop's last command, a false test would
  # be the script's exit status, and every send without a question reported failure.
  if [ -n "$question" ] && [ -z "$no_wait" ]; then await_answer "$dest"; fi
done
