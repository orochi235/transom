# The sidecar JSON for bin/transom's sends: sourced, not run. Reads the flags
# send.sh parsed.

# JSON string escaping, for text that may hold a quote, a backslash or a
# newline. The awk joins lines with a literal \n, since sed works a line at a time.
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'NR > 1 { printf "\\n" } { printf "%s", $0 }'
}

# The file `open -a` should be handed, made absolute: it is relative to this
# working directory and the daemon does not share it.
abs_path() {
  case "$1" in
    /*) printf '%s' "$1" ;;
    *) printf '%s/%s' "$(pwd)" "$1" ;;
  esac
}

# `label=url`, or a bare URL whose host becomes the label. Only what a browser
# will open: a `file:` link a page silently blocks is exactly the artifact that
# wanted --app, and `javascript:` is not a link.
link_json() {
  case "$1" in
    http://*|https://*) url=$1; label=$(printf '%s' "$url" | sed -e 's|^[a-z]*://||' -e 's|/.*||') ;;
    *=http://*|*=https://*) label=${1%%=*}; url=${1#*=} ;;
    *) fail "--link takes an http(s) URL, or label=URL ($1)" ;;
  esac
  printf '{"label":"%s","url":"%s"}' "$(json_escape "$label")" "$(json_escape "$url")"
}

# Beside the image and before it: the daemon triggers on the image arriving, so
# a sidecar written afterwards is a race it would lose.
write_sidecar() {
  [ -z "$2" ] && [ -z "$sha" ] && [ -z "$session" ] && [ -z "$attention" ] && [ -z "$note" ] && [ -z "$sandbox" ] && [ -z "$question" ] && [ -z "$group" ] && [ -z "$apps" ] && [ -z "$links" ] && [ -z "$quiet" ] && return 0
  sidecar_json "$@" > "$1.transom.json"
}

sidecar_json() {
  dest_image=$1
  dest_caption=$2
  {
    printf '{"repo":"%s"' "$(json_escape "$repo")"
    [ -n "$sha" ] && printf ',"sha":"%s"' "$(json_escape "$sha")"
    [ -n "$session" ] && printf ',"session":"%s"' "$(json_escape "$session")"
    [ -n "$session" ] && [ -n "$pid" ] && printf ',"pid":%s' "$pid"
    [ -n "$dest_caption" ] && printf ',"caption":"%s"' "$(json_escape "$dest_caption")"
    [ -n "$attention" ] && printf ',"attention":"%s"' "$(json_escape "$attention")"
    [ -n "$note" ] && printf ',"note":"%s"' "$(json_escape "$note")"
    [ -n "$sandbox" ] && printf ',"sandbox":"%s"' "$(json_escape "$sandbox")"
    [ -n "$question" ] && printf ',"question":"%s"' "$(json_escape "$question")"
    [ -n "$question" ] && [ -n "$choices" ] && printf ',"choices":[%s]' "$choices"
    [ -n "$question" ] && [ -n "$why" ] && printf ',"why":"%s"' "$(json_escape "$why")"
    [ -n "$group" ] && printf ',"group":"%s"' "$(json_escape "$group")"
    [ -n "$group_label" ] && printf ',"groupLabel":"%s"' "$(json_escape "$group_label")"
    [ -n "$of" ] && printf ',"of":%s' "$of"
    [ -n "$apps" ] && printf ',"apps":[%s]' "$(apps_json "$dest_image")"
    [ -n "$links" ] && printf ',"links":[%s]' "$links"
    [ -n "$quiet" ] && printf ',"quiet":true'
    if remote_on; then
      printf ',"host":"%s"' "$(json_escape "$(scutil --get LocalHostName 2>/dev/null || hostname -s)")"
      printf ',"zoneRoot":"%s"' "$(json_escape "$root")"
      if [ -f "$root/.hued" ]; then printf ',"hued":"%s"' "$(json_escape "$(cat "$root/.hued")")"; fi
    fi
    printf '}\n'
  }
}

# `Name` hands the app the artifact itself, which is the copy in the inbox and
# so is only known here; `Name=path` hands it something else.
apps_json() {
  own=$1
  first=1
  printf '%s\n' "$apps" | while IFS= read -r entry; do
    [ -z "$entry" ] && continue
    case "$entry" in
      *=*) name=${entry%%=*}; file=$(abs_path "${entry#*=}") ;;
      *) name=$entry; file=$own ;;
    esac
    if remote_on; then
      case "$entry" in
        *=*) echo "transom $verb: --app $name names a file on this host, so the wall cannot open it" >&2; continue ;;
        *) file=@self ;;
      esac
    fi
    [ $first -eq 1 ] || printf ','
    first=0
    printf '{"name":"%s","path":"%s"}' "$(json_escape "$name")" "$(json_escape "$file")"
  done
}
