---
name: transom
description: Wire transom into a Claude account or machine so renders reach the wall, diagnose why they are not, or change how one repo sends - back to Preview, onto a zone that is not its directory name, quieter, or with its own defaults, through that repo's .transom.yaml. Triggers on "install transom", "set up the wall on this account", "renders aren't reaching the wall", "agents keep writing images to /tmp", "stop sending renders to the wall here", "open images in Preview in this repo", "use a different zone for this repo", "stop this repo making noise", "set up transom for this repo", or checking what the current repo does.
---

# Wiring transom to agents, and setting one repo up

transom (`~/src/transom`) is a wall of generated images on a side monitor.
Images arrive, live for a while, then expire unless rescued. An agent puts one
there by writing a file into `~/transom/inbox/<zone>/` — that is the entire
protocol. There is nothing to connect to and no client library.

**Per repo there is nothing to install.** Once an account is wired, a new repo
is on the wall the first time it renders. A repo that wants something other
than the defaults says so in a committed `.transom.yaml` at its root, which
`transom post` reads on every send. The first section below wires an account;
the rest are that file.

**Zones register themselves.** `bin/transom` writes `~/transom/zones/<zone>.json`
recording which directory the renders came from, and the daemon reads that to
find the project's `.hued` and color the zone. It is written on every send, so
it is never something to maintain by hand.

## Install on a new account or machine

Run `~/src/transom/bin/transom wire`. It is idempotent — re-run it after any change
here rather than reasoning about what is already in place. It reports each
config directory as it goes, and puts three things in front of agents:

- **The skill**, symlinked into every `~/.claude*/skills/`.
- **The wall-nudge hook** (`hooks/wall-nudge.mjs`), registered as a
  `PostToolUse` entry tagged `transom` in each `settings.json`. It fires when
  an agent reads or creates an image that never reached the wall, and exits 2
  with a one-line correction, which Claude Code feeds back to the model. It is
  also how a render the viewer marked up on the wall comes back: at the
  sending session's next tool call it says `Your render "<caption>" was marked
  up on the wall ("No, like this"): <png> — "<text>"`. Read that picture; the
  marks are the correction.
- **`transom` on PATH**, symlinked into `~/.local/bin`. Without this, an agent that
  half-remembers the rule types `transom post chart.png`, gets `command not found`, and
  falls back to reporting a path.

`transom wire` also checks that some `CLAUDE.md` carries the rule and prints the bullet
if none does. It does not write it: that file is hand-authored prose, and a tool
that rewrites preferences fights their author. Add it by hand.

**Running sessions keep their hook snapshot.** Only sessions started after
`transom wire` pick the hook up — don't conclude from a live session that it failed.

`transom wire --dry` says what would change; `transom wire --off` removes all three.

## When renders still aren't reaching the wall

In order, because each step rules out the one below:

1. `transom zone` in the repo. `command not found` means `transom wire` never ran
   here, or `~/.local/bin` is not on this shell's PATH.
2. Does the repo's `.transom.yaml` say `show: preview`? Then `transom post`
   opens renders locally and the hook stays quiet, which is the file working.
   A file with an error makes `transom post` exit 1 and name each problem.
3. Was the session started before `transom wire`? Its hooks are a snapshot.
4. `curl -s localhost:8787/api/health`. A down daemon is *not* the cause: files
   written while it is down are picked up at its next start, provided they are
   newer than the TTL. Renders that never got sent are the cause.
5. Does this Mac send to a wall on another Mac? It does when
   `~/transom/wall.env` exists, and then a failed send says why:

   | What `transom post` says | Fix |
   |---|---|
   | exits 6, `the wall at <url> is not answering` | The wall's Mac is asleep, off the LAN, or its daemon is down. Nothing is queued: send again once it is back. |
   | `the wall refused this (HTTP 401)` | The token is stale. Run `transom pair <this Mac>` again on the wall's Mac. |
   | `the wall refused this (HTTP 426)` | The two Macs speak different protocols, and the message names both. `brew upgrade transom` on the one with the lower number. |

## A repo's `.transom.yaml`

`transom wire --repo`, run inside the repo, writes a starter file with every
setting commented out, so it changes nothing until a line is uncommented. Run
again, it checks the file; `--off` removes a starter nobody edited. The file is
**committed**: the settings belong to the repo, not to one checkout. Its first
line points the editor at the schema, and `transom post` enforces the same
schema — an unknown key or a bad value stops the send with every problem named.

Edit only the keys the user asked for, and leave the rest commented:

```yaml
zone: icons            # instead of the directory name
show: preview          # wall | preview: `transom post` opens the file locally
defaults:
  ttl: 30m             # as --ttl
  apps:                # as --app; a path is relative to the repo root
    - LDView
attention:
  loudest: soon        # look | soon | urgent | problem; a louder send is lowered
  sound: false         # keep the level, never play the sound
```

- **Put Preview back for this repo**: `show: preview`. Agents keep calling
  `transom post`; it is the command that opens the file, so the global rule
  still holds and nothing about it changes for any other repo. `transom ask`
  refuses here, since there is no card to ask on.
- **Put the repo back on the wall**: remove the `show` line, or set
  `show: wall`.
- **A different zone**: `zone:`. Only when the user asks for a name that is
  not the directory's — several checkouts that should pile onto one zone, say.
  Check the result with `transom zone` inside the repo.
- **A flag beats the file.** `--zone`, `--ttl` and `--app` on one send override
  it for that send.

The file is read from the main checkout, not from a worktree, for the same
reason the zone is: a worktree is named for its own hash.

## Status

`transom zone` in the repo prints where its renders go, with the file applied.
`transom wire --repo` says whether the file is valid. Then check the daemon:
`curl -s localhost:8787/api/health`. The default holds whether or not the daemon
is running; files written while it is down are picked up at its next start,
provided they are newer than the TTL.

## Notes

- **A zone comes into being when something is sent to it**, under the
  directory's name or the repo's `zone:`. Nothing registers one.
- **For one conversation only**, skip all of the above and pipe to
  `~/src/transom/bin/transom post --zone <name>` directly; there is nothing to install.
- **A marked-up render goes back to the session that sent it**, which
  `transom` records from `CLAUDE_CODE_SESSION_ID` and `CLAUDE_PID`. A `transom
  ask` still waiting gets it as its reply and exits 5, printing the picture's
  path and then the text. A session that has exited gets nothing: the wall
  holds the marks on the card until the viewer discards them.
- **The hook is a backstop, not the rule.** It fires after an image has already
  been missed. The `CLAUDE.md` bullet is what gets it right the first time, so a
  missing rule is worth fixing even with the hook in place.
