# Remote senders, and bounding what the wall keeps

**Status: designed 2026-10-05, not built.** Nothing below exists yet. Delete
this file once both pieces of work land and what is worth keeping has moved
into `DESIGN.md`.

This is for whoever builds the two pieces of work below. It answers two
questions. How does a Mac on the LAN, such as an onto fleet node, put renders
on a wall running on another Mac? And what keeps `~/transom` and the daemon's
logs from growing without limit? The second has to land first: remote senders
add volume to a disk that is already leaking.

## Why the bounding comes first

Expiry moves a card's file into `trash/`, and nothing ever deletes it.
`config.trashMs` (24h) is declared in `server/config.ts` and read nowhere. On
the wall host on 2026-10-05, `trash/` held 3.8 GB in 13,472 entries going back
to Aug 31. `.cache` held 2,138 thumbnails for 183 inbox files; no code path
was found that removes one. The LaunchAgent logs in `~/.local/state/transom/`
grow forever too, because launchd does not rotate them.

## Piece 1: the reaper

A reaper module in the daemon runs at startup and every 10 minutes. Each limit
can be overridden with a `TRANSOM_*` environment variable, like the rest of
`config.ts`.

| What | Rule | Variable |
|---|---|---|
| `trash/` | Delete entries older than `trashMs` (24h). Then, if the total is still over **10 GB**, delete oldest-first until under. | `TRANSOM_TRASH_TTL`, `TRANSOM_TRASH_MAX` |
| `inbox/` + `.cache` | Over **20 GB**, expire the oldest unpinned cards through normal expiry, so they go to the trash and the wall animates them away. Cards in an `eternal` zone are never taken; `indefinite` ones are, as `DESIGN.md` promises. | `TRANSOM_WALL_MAX` |
| `.cache` | Delete any thumbnail or poster that no card in the store refers to | — |
| `answers/` | Delete answer files older than 24h that no CLI collected | — |
| `marks/` | Delete records and PNGs for cards no longer on the wall, once older than the trash TTL | — |
| `~/.local/state/transom/*.log` | Over **25 MB**: copy to `<name>.1` (replacing it), then truncate in place | `TRANSOM_LOG_MAX` |

Truncating in place is safe because launchd opens the log with `O_APPEND`
(confirmed with `lsof +fg`, flag `AP`). Without that flag, the writer would
keep its old offset and leave a sparse file.

If pinned cards and eternal zones alone exceed the wall cap, nothing is evicted. `/api/health`
reports the size of each directory and whether any cap is exceeded, and the
band shows a `disk` chip while a cap is exceeded.

## Piece 2: remote senders

### Constraints

- Senders are fleet Macs only: same user, Homebrew available, on the LAN.
- The wall host has Remote Login switched off, so nothing can ssh *to* it.
  It can ssh *out* to every fleet node.
- The daemon already listens on `*:8787`, and fleet nodes reach it at
  `http://<wall>.local:8787`.

So the transport is HTTP to the daemon, and the install runs from the wall
host over ssh.

### Remote mode in `bin/transom`

The CLI is in remote mode when `~/transom/wall.env` exists (mode 600):

```
TRANSOM_WALL=http://orochi.local:8787
TRANSOM_TOKEN=<from the wall host's ~/transom/token>
```

`post` and `ask` behave exactly as they do locally, and print the same inbox
path. A wall that has not answered within 3s fails the send with exit 6 and
the message `transom: the wall at <url> is not answering`. Nothing is queued
locally.

### Endpoints

| Endpoint | Does |
|---|---|
| `POST /api/inbox/:zone` | Streams the body into `~/transom/.incoming/`. The sidecar is base64 JSON in `X-Transom-Sidecar`, and the name suffix (`.ttl…`, extension) in `X-Transom-Name`. The daemon writes the sidecar into the inbox first, then renames the file in, the same order the CLI uses locally, so ingest is unchanged. Returns `{ path }`. Over **2 GB**, it returns 413. A video when the daemon has no ffmpeg returns 422. |
| `GET /api/answers/:name?wait=30` | Returns the answer file's contents and deletes it, or 204 after 30s. The CLI repeats the request until it gets an answer. |
| `POST /api/marks/claim`, `GET /api/marks/:file` | Exist today. Now they require the token from any address other than loopback. |
| `GET /api/whoami` | 200 with the wall's hostname when the token is good. Used by `pair` to check the install. |

**Authentication:** the daemon writes a random token to `~/transom/token`
(mode 600) the first time it starts. Requests from loopback are exempt, so
the wall page and local sends do not change. All other requests to the
endpoints above need `Authorization: Bearer <token>`. To rotate the token,
delete the file, restart the daemon, and run `pair` again for each host.

**Version check:** remote requests carry `X-Transom-Protocol: 1`. On a
mismatch the daemon returns 426 with the text `brew upgrade transom on
<host>`, so fleet nodes on an old release fail loudly instead of having
sidecar fields silently dropped.

### What breaks across hosts, and the fixes

| Today | Fix |
|---|---|
| `zones/<zone>.json` stores the sender's repo path, and `zoneColors.ts` reads `.hued` from it | The CLI puts the `.hued` text in the sidecar as `hued`. The daemon stores it in the zone record, and `zoneColors` prefers it over the path. |
| Markup liveness (`markup.ts` `isLive`) checks the sender's pid on the wall host | The sidecar gains `host` (from `scutil --get LocalHostName`). For another host, a session counts as live if it called `marks/claim` within the last 2 minutes. |
| The hook only asks the daemon when `marks/waiting/<session>` exists locally | A remote send also writes `~/transom/remote-sessions/<session>`. While that file exists, the hook claims from `TRANSOM_WALL` on every tool call (2s timeout) and downloads each claimed PNG into the local `~/transom/marks/`. The hook deletes downloaded PNGs and session markers older than 24h. |
| The daemon reads a repo's `marks.unsent` through the zone record's root path | Nothing to do while the key only takes `keep`. When the queue lands, the CLI sends the key in the sidecar, the same way it sends `hued`. |
| `--app Name=path` names a file on the sender | Dropped with a warning in remote mode. A bare `--app Name` still works, because it opens the inbox copy on the wall host. |
| The CLI refuses video when the sender has no ffmpeg | Skipped in remote mode. The daemon checks instead and returns 422. |

### Install: `transom pair <host>`

Run on the wall host. One host per call, and safe to run again.

1. Over ssh: `brew install orochi235/tap/transom`, or `brew upgrade` if it is
   already installed.
2. Over ssh: `transom wire`. This links the skill, the hook and `transom` on
   PATH in every Claude config directory there.
3. Write `~/transom/wall.env` there, containing
   `http://$(scutil --get LocalHostName).local:8787` and the token.
4. From the host, call `GET /api/whoami` with the token, and print the result.

`transom pair --off <host>` deletes `wall.env` on that host and leaves the
Homebrew install alone. Remote mode needs a tap release newer than 0.2.0, and
`pair` refuses to continue when the installed version is older.

## Testing

- The reaper: a temporary `TRANSOM_ROOT` and an injected clock, one test per
  row of the table, plus the case where pinned cards alone exceed the cap.
- The endpoints: the daemon started on an ephemeral port against a temporary
  root. Covers authentication (from loopback, without a token, with a wrong
  token), 413, 426 and the long poll.
- The CLI: in the style of `server/ask.test.ts`, with `wall.env` pointing at
  that test daemon. Sends a post, then an ask that is answered through
  `/api/items/:id/answer`.
- The hook: `wall-nudge.test.mjs` gains the remote claim and download.

## Not in scope

The daemon's existing endpoints stay open to the LAN; see *Open questions* in
`DESIGN.md`.
