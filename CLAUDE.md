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
stopped delivering them once. When it misses one the band shows `page stale`
and `doctor` names the files; `transom cycle` catches the page up to the disk.

Installed from Homebrew the wall is one service instead,
`tech.michaelbaker.transom`, running the keg and not this checkout; `doctor`
says so when that is what holds the port. `DESIGN.md`, *Running it*, has both.

`npm run dev` refuses to start a second daemon behind the LaunchAgent rather
than dying with `EADDRINUSE` where the message scrolls past.

## Params are declared in the schema

A param's name, default, range, unit, and options live in `src/schema/params/`,
one file per top-level group, and its type in `src/params/`. Adding one means
both, plus a pointer to it (`to('group.key')`) on a page under
`src/schema/sheet/`, or a test fails. `DESIGN.md`, *Evaluating them*, has the
shape and the two kinds the wall draws itself.

## Changes sent from the schema page

`http://localhost:7750/schema.html` edits the schema as a draft and sends what
changed to this checkout. Each send is one JSON line at the end of
`.transom/schema-changes.jsonl`, holding `at` and `assets`: for each asset that
changed, its `id`, its `kind`, its `changes` as the editor lists them, and
`literal`, the whole edited asset as TypeScript.

| Asset id | Is | Lives in |
|---|---|---|
| `params` | Every param. | `src/schema/params.ts` and `src/schema/params/` |
| `sheet-<page>` | One page of the prefs sheet. | `src/schema/sheet/<page>.ts` |

Asked to apply what was sent, read the last line and apply every asset in it,
then delete the line and any older ones. The literal is one tree; the source
splits it:

- A top-level group goes to its own file, and `attention.levels` to
  `attentionLevels.ts`. Keep a file under a few hundred lines by splitting the
  same way.
- An option list kept elsewhere stays a reference: `named(TYPEFACES)`,
  `named(INBOX_MODES)`.
- A `choice` leaf is written `choice({ … })` with no `kind`.
- A pointer is written `to('path')`.
- A new or re-keyed param needs its type in `src/params/` to match, and a
  removed one needs its readers gone. A re-keyed param also strands the value
  saved under the old key: say so before applying it.
