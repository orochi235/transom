# transom

`DESIGN.md` is the design doc — what the wall is, what is decided, what is open.
`README.md` is the stranger's entry point.

## The daemon does not reload. Check it before you debug it.

The daemon and the client run as **LaunchAgents** — `tech.michaelbaker.transom.daemon`
and `.client` — detached, with `KeepAlive`, started with no `watch`. So the
daemon goes on serving whatever build it was launched from however many times
`server/` or `shared/` changes, and every symptom of that reads as a broken
feature rather than as a stale process: a field the daemon has never heard of is
dropped from a patch without a word.

**Before debugging anything that crosses the daemon, run `npm run doctor`.** It
prints what holds each port, when it started, and whether the daemon's build
matches this checkout. `npm run daemon:restart` kickstarts it.

The wall says so too: the band shows a `daemon stale` chip when the build the
daemon started from disagrees with its code on disk (`/api/code`). Both are the
last commit touching `server/`, `shared/` or the package files, so a
client-only commit never trips it. Vite reloads itself, so the client half is
rarely the stale one — but it only reloads on file events, and macOS has
stopped delivering them once (`DESIGN.md`, *Open questions*). If an edit under
`src/` does not show, `launchctl kickstart -k gui/$(id -u)/tech.michaelbaker.transom.client`
catches the page up to the disk.

Installed from Homebrew the wall is one service instead,
`tech.michaelbaker.transom`, running the keg and not this checkout; `doctor`
says so when that is what holds the port. `DESIGN.md`, *Running it*, has both.

`npm run dev` refuses to start a second daemon behind the LaunchAgent rather
than dying with `EADDRINUSE` where the message scrolls past.
