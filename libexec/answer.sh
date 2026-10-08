# Waiting on a question's answer, for bin/transom: sourced, not run.

# The daemon writes the answer to answers/<the name this gave the file>: the
# status on the first line, the answer after it.
await_answer() {
  answer="$transom_root/answers/$(basename "$1")"
  if remote_on; then remote_await "$(basename "$1")" "$answer"; fi
  while [ ! -f "$answer" ]; do sleep 1; done
  # Three parts: the status, the chip, then the free text. A blank second line
  # is what tells a free-text answer's first line apart from a choice. A
  # drawing has no chip, and its second line is the marked-up picture.
  status=$(sed -n 1p "$answer")
  choice=$(sed -n 2p "$answer")
  text=$(tail -n +3 "$answer")
  rm -f "$answer"
  if [ "$status" = marked ]; then
    if [ -n "$as_json" ]; then
      printf '{"status":"marked","image":"%s","text":"%s"}\n' "$(json_escape "$choice")" "$(json_escape "$text")"
    else
      printf '%s\n' "$choice"
      [ -n "$text" ] && printf '%s\n' "$text"
    fi
    echo "transom $verb: marked up instead of answered — read the picture above" >&2
    exit 5
  fi
  if [ -n "$as_json" ]; then
    printf '{"status":"%s","choice":"%s","text":"%s"}\n' \
      "$(json_escape "$status")" "$(json_escape "$choice")" "$(json_escape "$text")"
  elif [ -n "$choice" ]; then
    printf '%s\n' "$choice"
  else
    printf '%s\n' "$text"
  fi
  case "$status" in
    answered) exit 0 ;;
    dismissed) echo "transom $verb: dismissed without an answer" >&2; exit 3 ;;
    *) echo "transom $verb: the card was expired before it was answered" >&2; exit 4 ;;
  esac
}
