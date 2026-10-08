# transom

A wall for AI-generated renders, filling a side monitor. Images arrive from
agents, live for a while, then disappear unless rescued.

This is the design doc: what it is, what's decided, and what's still open. It
assumes no prior context.

## The thesis

Most software defaults to hoarding. Every generated image lands in a folder that
becomes archaeological sediment. transom inverts that: **ephemeral by default,
permanence earned by an act of attention.** Roughly 90% of what lands here is
not worth a second look. The name is the publishing one: a manuscript nobody
asked for came in over the transom, the window above the editor's door, and
most of that pile was never read twice. It is a reminder not to let this drift
into being an asset manager.

The problem it replaces: agents were told to open renders in Preview. Preview
steals focus constantly, and most renders aren't worth looking at.

## Architecture

**Daemon** (Node)

- The OS's own recursive watcher (FSEvents on macOS) watches `~/transom/inbox/`,
  one handle for the tree; `chokidar` is the fallback where that is not
  trustworthy — see Traps. A sweep offers anything the store lacks, so a
  dropped event costs a delay rather than the picture.
- Subdirectory name = zone ID.
- `sharp` downscales on ingest to 1024px longest edge; the original path stays
  in metadata for click-through.
- `express` serves the static bundle and the images.
- WebSocket pushes `{ id, url, zone, bornAt, w, h }` per arrival, and a full
  snapshot of live items on connect.

The daemon owns item lifetime. Clients are pure views: they receive `bornAt` and
derive age locally against a server-supplied clock offset. A client reload
therefore changes nothing about what is on the wall or how far along it is.

**Client** (React, served in the browser)

One render backend: r3f. Arrangements place in three dimensions — which is not
the same as perspective, and by default is not perspective at all (see The
stack's camera). The DOM/CSS backend it grew up beside was a hedge against the
3D wall not working; the 3D wall works, so it is gone, and with it the flat
arrangements and the `?backend=` flag that chose between them.

Run it chromeless:

```
open -na "Google Chrome" --args \
  --app=http://localhost:7750 \
  --user-data-dir=/tmp/transom
```

The separate profile keeps it out of the main browser's process pool so it
doesn't get tab-discarded under memory pressure.

## The menu bar widget

`menubar.yaml` at the repo root, generated into a status-bar app by
[perch](../perch). It reports and it opens things: the item count as a badge, a
warning glyph when the daemon is not answering, one row per zone that opens
that zone's folder, undo, and the inbox and trash.

**Man the wall goes to the default browser**, not to the chromeless profile
above. The profile is for the monitor the wall lives on and is worth typing
once; a menu item is for looking at it now.

It cannot start the daemon, and that is a property of perch rather than a gap:
an action is a subprocess it waits on, and `npm run dev:daemon` never returns.
Starting the wall wants a LaunchAgent of its own.

The two routes it polls — `/api/health` and `/api/zones` — hand back the
inbox and trash paths and each zone's folder, so the YAML names no directory.
That is what keeps a home directory out of a committed file.

## Arrangements

An arrangement is how images enter, move over their life, and leave. Which one
reads well on a monitor you are not looking at is genuinely unknown, so
arrangement is a swappable strategy rather than a decision baked into the
renderer.

### The interface

An arrangement is a windease `LayoutStrategy` plus the camera it wants: a pure
function from items and a container to rects, with transom's own channels
(`z`, `opacity`, `rotX/Y/Z`, `saturation`, `blur`, `lod`, `emphasis`) riding
alongside. `src/arrangements/types.ts` is the whole of it in code.

**transom takes windease's strategies and never its host.** `ContainerHost`
recomputes on store mutation, so driving it per frame would be sixty store writes
a second, and its nodes carry a lifecycle of their own — a second owner of "when
does this exist" beside the daemon. So every call passes `state: undefined`, the
allocators stay closures inside the strategy factory, and `now` rides in
`options`.

**`Rect.z` is required**, so the compiler catches a rect-producing site that
forgot depth, and a flat layout emits `0`, never `null`, because it genuinely is
at depth zero. A
placement is the square slot `w = h = side` and the renderer fits the image
inside it, so aspect never reaches a strategy.

**`channels` is untyped on purpose.** windease carries
`Map<id, Record<string, number>>` and never reads it. A number belongs there when
windease asks no question of it — fit, placed, under the cursor, which neighbor —
and a number it should reason about is a change to windease's core, not a
channel. A typed vocabulary would be windease's forever and would invite layout
depending on a rendering property ("is a transparent item unplaced?"); `number`
is the one assumption, because cross-fade lerps every channel blindly.

It is recomputed each frame, and pure. Two things follow, and they are the
reason for the shape:

- Swapping arrangements live is free.
- Cross-fading two is lerping two rect lists by `id`, so comparing them is a
  smooth A/B rather than a jump cut.

The constraint this imposes: motion must be a closed-form function of age, not
accumulated velocity. Springs are fine (a damped spring has a closed form);
arbitrary physics is not. An arrangement may cache per-`id` derived values, but
must tolerate that cache being dropped at any time.

That cache is not optional in practice. A stable per-item slot cannot be derived
from a pure layout call: any index into a sorted list shifts when an item
arrives (newest-first) or expires (oldest-first), moving every neighbour.
`slots.ts` holds the allocators that need, and `stack` uses the rank one.

### The set

Two: `stack`, and `inbox` (below), which `[` / `]` swap between. Seven were
sketched to span the space, on the plan that most would be thrown away — and
they were.

The six flat ones went with the DOM backend: `grid`, `tide` and `erode` were
built and are deleted, and `recede`, `settle` and `spiral` were never written.
They are listed below as what was tried, not as a backlog — anything worth
having from them is a 3D arrangement someone writes fresh.

✝ built, then deleted with the DOM backend.

| Name | Mechanic | What it tests |
|---|---|---|
| `grid` ✝ | Newest first in reading order, oldest falls off the end. No decay signal. | Control. Everything else has to beat this. |
| `tide` ✝ | Enter at one edge, drift at constant velocity across the wall, exit the far edge. Position *is* age. Size constant throughout. | Whether one coherent slow motion field reads better than N independent fades. Periphery is good at coherent motion. |
| `recede` | Enter at the front plane, move back in Z, shrink and fade with distance. | The original concept. Now a candidate rather than an assumption. |
| `settle` | Enter at the top, fall to a resting position, pack downward as items leave from the bottom. | Gravity as decay. The bottom row means "going soon" without saying so. |
| `erode` ✝ | Position fixed for life. Decay is desaturation, then blur, then dissolve. Zero motion. | Whether motion is needed at all, or whether a still wall is calmer and just as legible. |
| `spiral` | Enter at the perimeter, spiral inward, vanish at the center. | Centripetal reading, and whether a convergence point is restful or maddening. |
| `stack` ✅ | One diagonal pile per zone, tiled to a grid. Depth is rank: an arrival shoves the pile back. Only the top of each pile is legible. | Whether the wall is better as "which repos are producing" plus a zoom, rather than N readable images. |

### Ordering the zones

One key in the band orders the zones on the wall and the flag list in the
sidebar together — `project`, `severity`, `recency` — so the two can never
disagree about what is at the top.

The key reaches the layout as the order of the items, since a zone's cell comes
from where its name falls in the list the grid is handed. **`project` keeps the
held cells**: `createZoneGrid` assigns a slot per zone and holds it, so a new
zone appearing does not move every pile already on the wall. The other two keys
give that up by definition — a wall ordered by severity or by arrival
reshuffles as artifacts land — and take cells in the order the sort implies
instead.

**The column count fits the container, not the count of zones.** windease used
to auto-balance a grid on `sqrt(n)` alone — `orientation` biased which way a
non-square count rounded and was a fixed bias, never a fit — which kept the
grid square and said nothing about the shape it was squaring inside. Ten zones
in a container half again as tall as it is wide got four columns and three
short rows, every pile smaller than it needed to be. The fix went into the kit
as `orientation: 'fit'`, which takes the count giving the biggest square cell;
`zoneGrid.orientation` defaults to it, since a card is square and the cell to
maximize is the square one. A `cols` or `rows` set by hand still wins.

A zone pinned from its right-click menu leads whatever the key says. Pinned
zones among themselves fall back to the key rather than to when each was
pinned, because the order they were pinned in is nowhere on the wall. A pin is
a reordering asked for out loud, so it costs `project` its held cells for as
long as one is held — the grid would otherwise hand every zone the slot it
already had and the pin would reach nothing. The daemon keeps pins in
`pins.json`, so every viewer of a wall agrees about what is at the top. A
pinned zone's label carries a mark, since a zone leading under `recency`
because it is pinned would otherwise read as one leading because something just
landed in it.

Severity is a ranking the levels deliberately lack. `LEVELS` is a set of
treatments and not a scale, so the ranking lives in `src/nav/sort.ts` and
nowhere the ingest contract can reach it; a lapsed flag ranks below a live one
of any level.

**The band is remembered across a reload** — the sort key, the kinds, the time
range, the arrangement and the `list` row, in one object under
`transom.band.v1`. One object rather than a key per control is what keeps a
control added later from being forgotten by the store: `BandState` in
`src/nav/band-state.ts` has one reader per field, keyed on `keyof BandState`,
so a field added without one does not compile. The arrangement is stored by
name, because an index would point at a different layout the moment the
registry is reordered, and the time range as ages rather than timestamps,
because a stored absolute window has slid off the axis by the next visit. The
cost is real: a wall can come back narrowed, and what it is narrowed to is on
the band's face and nowhere else.

### The stack's camera

The camera belongs to `stack`'s design rather than to the renderer; `inbox`
borrows it unchanged.

**A pile is a volume, and nothing models it as one.** Its depth is
`rank × step.z` — 0.023 world units a card, against cards 0.305 on a side and a
wall 1.0 unit tall. A pile is deeper than a card is wide at 14 cards, deeper than
the entire wall is tall at 44, and `rankCap` 88 allows two walls. Every box
computed about it is nonetheless flat: the zone cell, the framed union, the plan
view rect. windease's `Rect` carries a z position and no z extent, so a layout
can say where in depth something sits and never how deep it is. Head-on that
costs nothing, because a footprint is all a head-on camera needs. It stops being
free the moment the camera leaves head-on, which is what the orbit added —
framing sees a pile's front face and not the length of it, so a turned wall
reads loose.

**Orthographic by default.** Perspective was the original assumption and it
fails on geometry rather than on taste: deep ranks converge toward the screen
axis, so the far corners of whatever box the camera frames are empty by
construction, and the wall shows dead space at the top and right whatever the
margins say. Under an orthographic projection the framed union is the drawn
union. Perspective stays available as `camera.projection`, because the two
answer *does a pile read as depth or as mush* differently and that question is
still open.

**Piles hang from a corner.** `origin` is where a pile meets its cell: the same
relative point of the card meets that point of the cell, so 0,0 is corner to
corner and 0.5,0.5 centers. Top-left by default, which is what lines up the top
and left edge of every pile on the wall.

**The camera orbits.** `camera.yawDeg`/`pitchDeg` place it around what it
frames, and dragging the canvas turns the scene by writing those same two
params, so the angle has one home rather than two. Framing itself is stated once
as a half-height; perspective derives a distance from it, orthographic parks at
`camera.standoff` and drives the frustum.

### Asking to be looked at

An item can ask for attention, and an agent sets the flag whenever it tells a
person to go and look at something. That makes it common rather than rare,
which is the constraint the treatment is designed against: a wall where a third
of the cards shout is a wall where none of them do.

**One strength, 0..1, drives every cue**, so they cannot drift apart. It is a
step and not a ramp — the flag is live or it is not — computed on the daemon's
clock for the same reason `age01` is, so a reload does not restart a hold.

- **It does not recede.** Emphasis floors the `distance` falloff rather than
  being applied after it, so burying a flagged card can dim it no further than
  the flag allows. This is the cue that still works an hour later, when the
  card is at rank 20.
- **It stands out of its pile**, by a world-space lift in front of its own
  front rank, applied at the mesh beside the other position corrections.
- **It wears a halo** in `colors.attention`, reusing the per-card line that
  `overlay.cardEdges` drives. The halo wins the line where both want it: a
  flagged card is not also reporting its slot extent.
- **It breathes.** A scale pulse, amplitude scaled by emphasis, so an unflagged
  card is exactly as still as it ever was. This costs nothing extra: the canvas
  has no `frameloop` prop, so r3f is on `always` and the wall already redraws
  every frame.
- **It wears a plate**, the note in the level's color, and the halo takes the
  same color so the two read as one thing. A pile's plates stand together as a
  ladder that steps the way the pile does, each plate level with its own card,
  on one side of the pile, with a line from the center of the plate's facing
  edge to the card's nearest border. The one plate of a front card rests on the
  card instead and needs no line. Which side, and how far out, is solved for
  the whole wall at once (`src/nav/ladder.ts`): plates pay for the cards they
  cover, for hanging off the usable screen — the band and an open sidebar are
  not room — for their lines, for standing on another zone's cell, for lines
  that lean away from the other lines in their pile and on the wall; piles pay
  for disagreeing about the side, for standing on a side where the deeper
  cards' edges are buried under the front one, and for not lining up directly
  above or below another ladder. The wall keeps the layout it has unless a
  new one beats it by a share of its score, so zooming, which scales every
  score together, never moves a plate by itself. The solve projects through
  the camera as it will stand when the current move lands, not where it is
  mid-ease, so a spot chosen during a move is still right after it.
- **Plates face the camera by default** (`attention.billboard`) and all stand
  on one plane just in front of the nearest card, moved along their own line
  of sight so they stay put on screen. Off, a plate lies in its card's plane
  and turns with the wall. `attention.leaderElbow` makes the line leave the
  plate square and turn once onto the card, instead of running diagonally.
- **Leaving a card puts you back where you were.** A badge, the flag list, the
  menu or a loud arrival can open a card from the wall or from another pile;
  the view remembers that start, and closing the lightbox returns to it rather
  than to the card's own pile. Paging sideways in the lightbox keeps it.

**Every sound comes with a toast.** The daemon is the thing that plays it, so
the daemon says so: an `alert` message with the zone, the level, the repo and
commit when `transom` knew them, and what the card wants — its question, else its
note, else its name. The wall shows it bottom left until it is read or twelve
seconds pass, and clicking it walks to the card. A sound with nothing on
screen to explain it is a noise; this is what makes it a message.

**A flag ends by being dismissed or by lapsing, never by the card expiring.**
A hold of null holds until someone dismisses it; any other hold lapses on its
own. Either way the card goes on living out its TTL as an ordinary card.

### Asking a question

`transom ask "..." [--choice a --choice b] FILE` puts a question on the card and
waits for the answer: it prints the answer and exits 0, or exits 3 if the
question is dismissed, 4 if the card is expired first and 5 if it was marked
up instead (*Marking up a render*). An agent runs it in
the background, so the answer arrives as the command finishing.

- **The answer is a file**, `~/transom/answers/<the name transom gave the file>`: the
  status on the first line (`answered`, `dismissed`, `expired`, `marked`), the answer
  after it. Not beside the image, since expiry renames that into the trash.
  `transom wait PATH` waits on it again if the first wait was lost.
- **A question always flags its card**, at `look` unless the agent names a
  level, and the question is the badge unless there is a `--note`.
- **Opening the card does not close it**, although opening clears an ordinary
  flag. Only answering, the lightbox's dismiss, the flag row's × or expiring the
  card does. `/dismiss` closes a question only with `?question=close`, so an
  open wall on older code cannot answer for the viewer.
- **An open question has no TTL.** Someone is waiting on it. An answered card
  gets a whole TTL from its answer, since the question may have been open for
  longer than one.
- **A closed question stays on the card, inert, beside its reply**: a
  half-strength badge reading `question → answer`, and the lightbox panel with
  the chosen answer lit. Answering in the lightbox holds the reply on screen for
  a second, then plays the lightbox out.
- **One question, one answer.** With choices, the answer must be one of them,
  since the agent branches on the exact string.
- **A waiting question wears a corner chip, and an answered one keeps it.** The
  plate is not enough on its own: it lapses, and it never said anything about a
  question that *had* been answered — so a card that used to be interactive
  looked like any other picture. `?` in the flag's own color means something is
  still waiting; `✓` in the ordinary chip colors means it is a record now. A group
  counts what is left rather than what is done (`? 9`, then `✓ 12`), because how
  many are outstanding is the reason to look. Bottom-right, the last free
  corner: a card can be pinned, hold more than the wall draws, wear its age and
  still be waiting on a reply. The lightbox's status row says the same thing in
  words — `needs a response`, then `responded` — where there is room for them.
- **A question may take a chip and a comment.** `--why` adds a free-text box
  under the choices, and the reply then carries both: `choice` is the chip,
  `text` the box. **The chip is the submit** — clicking one, or pressing its
  number, sends whatever is in the box, empty or not, and text alone cannot
  send. One rule rather than two, and it is what leaves no state in which the
  wall has to guess whether the viewer is finished.
- **The answer file has three parts**, since it now carries two: the status,
  the chip, then the text from line 3 on. A blank second line is what tells a
  free-text answer's first line apart from a choice, and it stays line-based
  because `bin/transom` is `sh` and has no JSON parser. `transom ask --json` prints
  the whole reply for a caller that wants both fields.

### Marking up a render

In the lightbox a picture — a card, or one take of a group — can be drawn on
and sent back. `mark up` in the meta row fits the picture above a bar of tools
(freehand, arrow, box, note, select, undo) and a line of text; **No, like
this** flattens the marks onto the original at its own resolution and hands the
result to the daemon. Pages, videos and meshes have no picture to draw on.

- **The drawing is labkit's annotation overlay**, hosted outside a lab through
  its public exports only: the lightbox owns the surface a lab would (a
  container and one buffer from `@weasel-js/labkit/surface`) and mounts
  `AnnotationOverlay` over the image, with `createAnnotationStore` holding the
  marks and its `capture` producing the PNG. A note's words are asked for where
  it was put down, since the overlay makes text marks with none. The overlay's
  one input rule is copied into `markup.css` rather than importing labkit's
  stylesheet, which sets weasel's document tokens for the same reason
  `weasel.css` exists.
- **It goes back to the session that sent the card.** `bin/transom` records
  `CLAUDE_CODE_SESSION_ID` and `CLAUDE_PID` in the sidecar, and the sender is
  live while that pid is a running `claude` process. Three outcomes:
  - **A question still open** — the `transom ask` blocked on the card, or one
    sent with `--no-wait` — is answered by the drawing, when its sender is live
    or recorded no session at all. The answer file's status is `marked` and its
    second line is the composite's path; `transom ask` prints the path and the
    text and exits 5.
  - **Live, not asking:** the drawing waits for the `wall-nudge` hook, which on
    that session's next Read, Write or Bash asks the daemon for it and tells the
    model `Your render "<caption>" was marked up on the wall`, with the path and
    the text. Handing it over is what marks it delivered.
  - **Not live:** it stays pending on the card, and nothing is dropped.
- **Pending holds the card.** A card with unsent marks never ages out and is
  not trashed at startup, the way a rescue is not; the corner chip reads `✎` in
  the flag's color, the lightbox shows the composite in place of the original,
  and the status row says `marks unsent` while the sender is running and `marks
  held` once it is not — rechecked every 15 seconds. `discard marks` throws it
  away on purpose. Delivered or discarded, the card ages again from then, a
  whole lifetime, the same as an answered question.
- **On disk**, beside the answers: `~/transom/marks/<id>.png` and `<id>.json`
  (status, text, the serialized marks, the sender), one per artifact — drawing
  again replaces it. Discarding deletes the composite. Expiry moves both into
  the trash with the card and undo brings them back, so they are bounded by
  the card's own life and then by the trash, which is not. While any pending
  drawing is for a session, `marks/waiting/<session>` exists: the hook stats it
  on every tool call and only asks the daemon when it is there.

### The loupe

Holding Alt over a picture in the lightbox raises a square lens that follows
the pointer. It shows the picture's own pixels, unsmoothed, so a render fitted
down to the window magnifies into its real detail rather than the screen's.
Alt+S switches it to smoothing between those pixels and back, and the choice
is remembered per browser; an SVG has no pixels to choose between and is
redrawn sharp at the lens's scale instead. A pill in the top-left corner says
to hold Alt, and which mode is on while the lens is up. While it is up the wheel sets its magnification instead of zooming the
picture, and the meta row reads the hex color under the pointer. Hold only:
there is no key that leaves it on. Pages, videos and meshes do not get one,
and it is off while marking up.

- **It is labkit's `TrialLoupe`** with a canvas source and `enabled={false}`,
  hosted outside a trial the way the markup overlay is. The source is a canvas
  holding the picture at its natural size, made the first time the lens reads
  it, with the picture's on-screen box as where it sits. The lens's two rules
  are copied into `loupe.css`, for the reason `markup.css` copies its one.
- **The smooth and vector lenses draw themselves.** labkit's canvas-source
  lens turns image smoothing off with no switch, so both pass `render` and
  draw through the lens camera — smooth the held canvas, vector the `<img>`
  itself, which Chrome rasterizes afresh at the size it is drawn. The source
  still answers the hex.
- `node tools/loupe-check.mjs` checks it in a headless browser against a
  scratch daemon.

### Groups: many pictures, one card

An agent that renders sixty parts wants a verdict on each. Sixty cards is spam
and sixty lightbox interrupts is worse, so `transom post --group <id>` sends a **take**:
every send naming the same group joins one card, which opens into a carousel.

A group is a fourth `kind` beside `page`, `video` and `mesh` — the same shape as
those, a poster on the wall and something else in the lightbox — and the first
artifact that **grows after it lands**. Nothing else in the ingest contract
appends to a live item, and that is the one new mechanic: a take ingests exactly
like a picture and is then appended rather than inserted.

- **A group's id is derived from its zone and name**, so an append is a lookup.
  The create-or-append is one synchronous store call with every `await` already
  finished, because two takes landing in the same tick must not both create the
  card — the failure is two cards with the same name holding half the takes
  each, and it only shows under load.
- **They are `takes`, not frames.** `WallItem.frames` already means how many an
  animated picture plays; one word for two quantities would make the badge a
  guess, the same call `duration` got against `frames` for video.
- **The card draws the first unanswered take**, so it shows what it wants from
  the viewer and works through the group visibly as each is answered, settling on
  the last once nothing is waiting. The store recomputes the poster wherever
  that can change — a take arriving, a question closing — and broadcasts it, so
  no renderer holds a copy of the rule.
- **The badge reads `⧉ 3/12`**, where the video's `▶ 0:12` sits. A group that
  never said how many were coming reads `3/7+`: the count so far is true and the
  total is not known, and a bare `3/7` would claim it was.
- **A group alerts once.** The first take's level applies and every append lands
  silently. Without this a group at `urgent` is one lightbox interrupt per render,
  which is the thing a group exists to stop.
- **A question belongs to a take.** A group whose takes each ask the same thing is
  the common case and the caller's business to repeat; a group whose takes ask
  different things — or ask nothing, which is a slideshow — costs nothing extra
  this way.
- **Answering advances to the next take still waiting**, not the next take, and
  the lightbox plays out only when the last one closes. The arrows page the
  carousel, claimed with a capture listener the way the video lightbox claims
  the space bar, and a long triangle at each window edge says a take is that way
  — drawn only where one is, so the pair never points at nothing.
- **`dismiss` sits beside the chips, not among them**, at `0` and set off by a
  gap: a take dropped without a verdict is not one of the outcomes. It closes
  that take alone. The card's own dismiss still closes every open take at once,
  and an expiry takes the whole carousel to the trash under one name per file.
- **The group is the unit of lifetime.** Its TTL restarts on every append, since a
  group still producing is not stale, and any unanswered take holds the card off
  the clock. `MAX_TAKES` is what bounds a card's size: the only other bound is
  how long the agent runs.

### Getting out of the wall

A verdict is often not the end of it — the render is wrong and the next move is
the source file in the app that made it. `--app "LDView"` offers an app,
`--app "LDView=parts/3001.dat"` says what to hand it, and `--link "label=url"`
adds an anchor. Both are the sender's, both per take, and both appear under the
question.

**The daemon runs `open -a <name> <path>` and never a command line.** The wall
passes a take and an app *index*: `/api/items/:id/open` already refuses to take
a path from the browser, and it must not start taking an app name either. What
does widen is that the store now holds paths outside `~/transom` — the sender
declares a file in its own repo and the daemon will open it. That is the same
agent that writes into the inbox, so it is inside the existing trust boundary
rather than past it, but it is the first thing in the store the daemon did not
put there.

A failed `open` toasts. An alert's spawn failure is swallowed because a missing
`afplay` must never cost the arrival; a button that silently does nothing is a
different thing, and says "no app named LDView" on the row the alerts use.
Links are `http(s)` only — a `file:` link a browser silently blocks is exactly
the artifact that wanted `--app`.

### Zipping a stack

"Copy artifact" carries one picture. A pile is the other unit a viewer wants
whole — the twelve frames a sweep left in a zone, the eight takes of a group — so
the right-click menu offers **Download zip (12)** and, on a group, **Download zip
of the group (8)**. The zone's zip is on a card's menu as well as the zone's own: a zone
target needs the label or the floor between piles, and the thing the pointer
actually lands on is a card. Originals, never the wall's capped thumbnails. A group
inside a zipped zone contributes a folder of every take, not the one take its
card happens to be drawing: the card stands for all of them and a zip that
quietly dropped seven would be the wrong archive.

Two decisions worth keeping:

**Stored, not deflated.** The wall holds PNG, JPEG, WebP, MP4 and glb, which
all deflate to within a percent of themselves. Compressing costs the daemon a
core per download and buys nothing.

**A GET, streamed.** `/api/zones/:zone/zip` and `/api/items/:id/zip` are the
only reads beside `/img` and `/orig`, which is what lets the menu start a
download by navigating rather than holding the whole archive in a blob first.
One file is in memory at a time, and a file the disk no longer holds is left
out rather than failing an archive that is already half sent.

The zip writer is in `shared/` because the demo wall has no daemon and builds
the same archive in the page, so what a visitor downloads is what the real
wall gives.

### How depth reads

Two things say "this card is far back," and they are deliberately different
senses of far: **rank** is how buried a card is in its pile, and **age** is how
close it is to expiry. A busy zone buries a card in minutes; a quiet one holds
its second card for a day. So both earn a curve.

**Detail falls off with rank, and so does presence.** The LOD tiers already
drop a card from 512 to 128 to 32 to a flat color chip as it is buried, which
means depth read as *loses detail* and nothing else — a buried card came out
blocky and at full luminance at once, and turned off head-on the deep tail was
the brightest thing on the wall. `distance` is the other half: presence falls
across a rank window to `distance.floor` and stops there. Never to zero, because
an invisible tail is a shorter pile rather than a deeper one.

The window is in **ranks, not world z**, so it keeps its meaning while `step.z`
is tuned, and so it lines up with the tiers that already divide the pile.

**How the two curves meet is a live control**, because it is a judgment and not
a fact. `ceiling` scales age's presence by depth's, so they compound and a card
that is both deep and old is dimmer than either alone; `min` takes whichever is
dimmer, which holds a deep card at the floor and hides its fade until age drops
past it. Both end at nothing for a fully expired card — they only disagree while
a fade is running. `distance.enabled` off is the wall before any of this.

**A foreign card in a zone's cell is dim because it is deep.** `step.x`/`step.y`
walk a pile diagonally out of its own cell as rank grows — past two card widths
by rank 40 — so a card only reaches a neighbour's cell by trailing there in z.
The falloff therefore dims exactly the intruders while sparing every zone's
front ranks, and the confusion of a stranger's panel reading as local is a
symptom of the missing falloff rather than its own problem.

**The fade and distance curves are swappable from code and are not parameters.**
`createStack` takes an optional pair of functions. `StackParams` round-trips
through localStorage and the clipboard as JSON, where a function does not
survive, so a curve shape cannot live there. Nothing in the repo passes them.

### Walking the hierarchy

The view is a **path**, not a level: `[]` is the wall, `['weasel']` a pile with
focus, `['weasel', 'img-1']` a card. `reduceView` only climbs and lands, so a
rung added later costs it nothing. What a rung *means* — which box the camera
frames, whether it draws in the scene or raises an overlay — stays with the
renderer, which has to be taught a new rung's geometry regardless.

**A click at the wall opens the zone's top card, not the pile.** The wall
already answers "which zone is producing" by being looked at, so a click on one
is asking the next question — what did it make. Spending that click on a rung
means clicking twice before anything can be read, and the first of the two shows
a pile the eye had already taken in. So a click anywhere on a zone — its
backdrop, its front card, or a card buried in it — lands on that zone's top
card, and `reduceView` remembers the wall as where the jump began, so closing
the lightbox goes back there rather than into the pile. **Shift keeps the rung**,
for when the pile itself is the thing being looked at, and the double-click that
opens the prefs sheet lives behind shift with it.

**One rung per gesture otherwise, and either across or down, never both.**
Wheel, pinch and a shift-click all spend themselves through `stepToward`, and
inward targets whatever is under the cursor rather than whatever has focus. A cursor over a different
pile spends the step moving there; only the next one descends, so the camera
never arrives somewhere the eye did not watch it travel. Reachable mostly at the
wall: once a pile has focus the framing leaves little of its neighbours on
screen, which is what the arrows and the plan view are for.

**The wall has one step further out than the hierarchy.** Outward at the wall
backs the camera off to `camera.zoomOutRoom` times the wall's margin, and the
next inward step comes back to the ordinary frame rather than into a pile. It is
not a rung: it lives beside the path, so the URL and `reduceView` never see it,
and walking into a pile forgets it. The sidebar's debug section draws the widest
frame as a box through the scene's depth, and the default frame inside it.

**A gesture is separated from its momentum by a gap, not a dead time.** A
momentum tail keeps delivering for most of a second, so any cooldown lapses
while the same flick is still arriving and buys a second rung. `nav.quietMs` is
the silence that ends a gesture. But a gate on gestures is not a gate on rate —
every notch of a mouse wheel is its own gesture, and brisk notches walked the
wall as fast as a flick — so `nav.floorMs` sets the least time between rungs,
and **it has to exceed `quietMs`** or the response goes bimodal across that
boundary. `quietMs` in turn has to exceed a frame: under about 16ms every event
of a trackpad stream reads as a new gesture and zeroes the charge, and the wall
stops answering the wheel at all. A pinch skips the gate: fingers on the glass
carry no momentum, so there is no tail to separate. The lightbox reads the same
gate, which is how the flick that opened it is stopped from zooming the image it
landed on.

**A pinch is a wheel event with `ctrlKey` set.** macOS reports a trackpad pinch
nowhere else, so the two are one handler at two scales — pinch deltas run an
order of magnitude smaller, which is why `nav` carries a threshold for each.
Without `preventDefault` the page zooms instead of the wall.

**A pile is picked by hit-testing its cell, not by a plane in the scene.** An
invisible plane per cell has to sit behind the deepest card `rankCap` allows or
it steals the card picks, which puts it several world units back and
parallax-shifted the moment the camera turns. Hit-testing the cells answers for
a pile with no cards in it too.

**Over a pile's base, only that pile's cards can be picked.** Perspective swings
a deep pile's back ranks across its neighbors, and the nearest card would win
clicks the base under the pointer plainly owns. Between bases the nearest card
still wins.

**`camera.margins` holds one entry per rung**, the last serving every rung past
it. Arrows are read by rung the same way: across the zone grid at a pile, and
front to back through the pile itself inside a card, clamping at both ends —
unless the band's `list` row (`L`) is on, which chains every pile into one row
so paging carries across. Shift and an arrow jumps to a neighboring pile's
front card. The list reads piles by row, then left to right by where their
front cards sit, and each pile deepest to front, so every step reverses exactly
and the ends do not wrap. Delete or Backspace expires the open card and moves to
what ← would open, else →, so the lightbox never closes and reopens; with
nothing left it steps out. `src/nav/list.ts` holds the rules.

### Entry behavior is a separate axis

Arrivals landing at full presence is the wall's loudest event, and arrivals are
mostly throwaway — so the design spends its whole attention budget on the least
valuable moment. `bloom` is a modifier, composable with any arrangement: new
items enter dim and small and ramp to full presence over the first ~10% of their
life. The wall stops flinching every time a render drops.

Keep it a flag, not an arrangement of its own. Both settings of it need testing
against every arrangement.

### Evaluating them

- `[` / `]` cycle arrangements; the name flashes briefly in a corner.
- Changes cross-fade over ~1s.
- `bloom` toggles independently.
- **Every stack parameter is a live control** — sliders, selects and toggles in
  a panel on the wall. Tuning by editing source and reloading does not converge,
  which is the whole reason it exists. The answers get written back to
  `src/params.ts` once they settle.
- **A plan view** in the corner names each zone, lights the one with focus, and
  zooms to a pile when clicked. It fills each icon with the zone's real
  pattern, worn as a mask over the zone's tint — the same pictures the swatches
  wear, drawn by the shader that draws the wall, so there is no second
  implementation of seventeen patterns here to drift from the first.
- **The `zones` group** owns how a zone presents itself: outline, label, and a
  backdrop filling its cell — a ruled hatch by default, or crosshatch, grid,
  chevron, waves, bricks, basketweave, parquet, triangles, hexagons, scales,
  dragonscale, dots, checks, argyle or a flat tint, all drawn by one shader in
  world space so it holds one density across the wall and costs the texture
  budget nothing. **The pattern and how it is ruled are one decision**, so
  density, repeat and rotation sit with the swatches rather than in the
  parameter list, and a zone overrides each of them the way it overrides the
  pattern. `chevron` and `waves` are the two built on two axes, so they are the
  two that show a repeat: a chevron is read by the angle between its arms,
  which is the ratio of its two pitches, and one pitch fixes that angle at
  forty-five degrees.
  The backdrop sits a hair behind the zone outline rather than
  behind the pile: it writes no depth and draws ahead of the cards, so it never
  occludes them however deep they go, while a plane parked at the deepest rank
  parallaxes away from its own border as soon as the wall turns.
- **Zone chrome is drawn on the pile's base card, not on what it has drawn.**
  Outline, backdrop, label and the plan view all use `baseCellsOf`, so a tall
  pile does not claim more of the wall than its neighbour. The camera is the
  exception and still frames the union, because that is what is on screen.
- **The sky is shaded by the camera's orientation, not its projection.** A
  full-screen quad whose vertices are already clip coordinates, so it cannot be
  clipped by the orthographic slab, picked, or made to occlude a card — it is
  behind everything by render order. The view ray comes from a spread of its
  own (`sky.spreadDeg`) rather than the camera's fov, because an orthographic
  camera's rays are parallel: borrowing the real projection samples one
  direction and paints the screen flat. So turning the wall turns the sky and
  zooming does not move it, whichever projection is in use. No animation,
  because a breathing background is decoration competing with the cards. Not
  for the cost: the canvas sets no `frameloop`, so r3f is on `always` and the
  wall already redraws every frame whether or not anything moved.
- **A raw shader writes sRGB, so its colors must not be converted.** three
  takes an authored hex into its linear working space on the way in and its
  built-in materials convert back on the way out; a `ShaderMaterial` writing
  `gl_FragColor` does neither, so `Color.set` renders several stops too dark.
  `srgb()` in `sky.ts` keeps the value raw. The zone hatch still uses
  `Color.set` and reads darker than its palette entry says.
- **Preferences have two surfaces** — the corner panel and a sheet on `,`, and
  a shift-double-click on any zone's bare backdrop opens the sheet too (behind
  shift because a plain click there now opens the zone's top card) —
  rendering one `ParamsBody` so they cannot drift while prefs is still a copy
  of params. The sheet's left column leads with `general`, then lists surfaces
  with six areas of the wall nested under `params` — piles, cards, flags,
  zones & sky, camera & input, chrome. A leaf lands in an area by the longest
  prefix of its path in `src/params.tabs.ts`, so `lod` splits and `colors`
  dissolves into the areas of what it colors while every path stays where a
  saved set expects it. `params` itself shows every group in columns. The
  modal is a delamin8r window, tuned by the `prefs` group.
- **`general` is the tab for what you want first, not for one part of the
  wall.** It is absent from `CATEGORIES`, so it never nests under `params`, and
  its leaves are drawn from wherever they live — `general.parallax`,
  `typeface.chrome`, `camera.projection` — by the same longest-prefix rule,
  which takes them out of the area they would otherwise sit in rather than
  showing them twice. It also carries the daemon's lifetime, the one setting in
  the sheet that holds for every browser rather than this one; that retired the
  `wall` tab, whose only row it was.
- **`general.parallax` gates every delamin8r surface** — the band, the card
  menu, the `?` card and this sheet — over each surface's own flag, so a
  surface tuned off stays off when the gate comes back on. The menu and the `?`
  card have no flag of their own and answer to the gate alone. The two hook
  surfaces are detached by passing a null ref rather than tuned flat: a handle
  that is torn down leaves the DOM as it found it, where a zeroed `step` would
  leave every plane composited for nothing.
- **The scrim is the stage, not the sheet.** A delamin8r stage never moves, so
  staging the sheet left its own 1px border as the only reference the eye had —
  and a border is where the motion is smallest. Every plane traveled under a
  pixel. The sheet is a plane in its own right now and swings against the wall
  showing through the scrim, which has detail in it to move against. This is
  the rule for any `window`-mode modal: the backdrop is the stage.
- **Depth is bought with `swing`, not `step`.** A plane's travel goes as
  `swing * z / (perspective - z)`; the compositing that softens its text goes
  as `z / perspective`. So the viewpoint is the free half and Z is the
  expensive one, and the sheet reads deeper than it did while scaling its text
  less. `drift` is off here: in `window` mode it moves planes *with* the
  pointer, against the parallax rather than on top of it as its own
  documentation says, and at any Z worth having it wins.
- **An area that fits gives up its scroller.** A scrolling box takes its whole
  subtree out of 3D, and moving the scroller up to the sheet or the scrim only
  moves the flattening with it — so the body's controls get planes only when
  the body does not scroll. Seven of the eight areas fit; only `params`, which
  shows every group at once, overflows, and it overflows sideways, since a
  multicol box with a fixed height spills into more columns rather than down
  the page. So the body takes `data-fits` when it has nothing to scroll, drops
  to `overflow: visible`, and its group cards become a plane of their own; an
  area that overflows keeps the scroller and stays flat. `scrollWidth` reports
  the overflow in either state, so the switch cannot flip-flop.
- **`typeface.chrome` is the face the DOM wears.** App publishes it to the root
  as `--chrome-face`, and every panel, sheet and menu reads that rather than
  naming a font. The `?` card's wordmark and crest keep their own faces; they
  are a specimen.
- **`colors` is the wall's whole palette**, ten entries driving both halves: the
  scene reads them as `THREE.Color`, and `applyColors` writes them to the root as
  custom properties for the DOM chrome. Alpha variants are `color-mix` in the
  stylesheets, so one entry covers every use of a color rather than one entry
  per declaration. This is the surface a theme would drive.
- **A tuned set moves by clipboard or by file.** The clipboard is the fast path,
  since what it holds pastes into `src/params.ts`; the file is for keeping named
  sets. Import goes through `mergeStored`, so a stale or hand-edited blob loses
  its unknown keys and its mistyped values rather than corrupting the panel.
- **Sim mode** synthesizes fake arrivals at a dialable rate from a fixture
  directory. This is the important one: it lets a 200/hour wall be evaluated in
  three minutes instead of by waiting for one. It does not answer what the real
  rate *is* — only living with it does that — but it decouples the layout
  question from that wait.

### Inbox

Every artifact on the wall at once, zones ignored, newest first. `stack`
answers "what is each project doing"; inbox answers "what has arrived", which
is the question a wall nobody has looked at for an hour actually raises.

How it lays them out is `inbox.mode`, in the prefs sheet's inbox tab, because
which reads best is as unknown as which arrangement did:

- **`grid`** — equal square cells in reading order, newest top-left.
- **`mosaic`** — size is age: the newest `big` take three cells square, the next
  `mid` take two, the rest one.
- **`river`** — distance from the left edge is age. Cards are dealt to `lanes`
  in arrival order, and one that would overlap the newer card ahead of it is
  pushed right, so at a high arrival rate position is rank more than age.

In every mode cards shrink as the count grows, down to `inbox.floor`; past it
the oldest leave the wall and the band says how many (`· 44 off wall`). Age
fades a card through the same `fade` window `stack` uses.

**Inbox is flat**: `Arrangement.flat` tells the renderer zones are not a level
of this wall. It draws no zone cells, so every piece of zone chrome — labels,
count chips, the plan, the wall cursor, floating badge shelves — goes with
them. A card opens straight from the wall and Escape returns there; in the
lightbox → is older and ← newer, across zones. Every card wears an age chip
if it is at least four chip heights wide.

## Ingest contract

Agents write files to `~/transom/inbox/<zone>/`. That is the entire integration
surface — any agent that can write a file already works.

Directory names are the source of truth for which zones exist. A config file, if
one ever appears, may only decorate a zone that already exists by name (display
label, color, memory budget). If a zone needed a config entry to show up, an
agent writing to a new one would produce silently invisible images, which is the
worst available failure for a system whose whole promise is "just write a file."

```sh
~/src/transom/bin/transom post render.png       # zone defaults to the repo name
~/src/transom/bin/transom post --caption "the sky, turned" render.png
some-generator | ~/src/transom/bin/transom post --zone renders
~/src/transom/bin/transom zone     # the one implementation of the rule
```

`transom` refuses an extension the wall does not hold, and says which it does.
The check belongs at the send for the same reason zones may not need
registering: a file the daemon will never adopt is a silently invisible image,
and it is worse than one, because nothing expires it either — only an adopted
artifact is ever trashed. `server/kind.ts` is the list; a test holds the script
to it.

Ask `transom` for the zone rather than deriving it. A caller that sanitizes the
repo name slightly differently binds the repo to a second, adjacent zone, and
the wall shows the split without ever reporting an error.

**Provenance is written, not asked for.** An instruction to stamp metadata is
the kind that fails silently and stays failed — nothing about a render looks
wrong when the field is missing, so compliance drifts. `bin/transom` is the
chokepoint every render already passes through, so it writes what it can see
(the repo and the commit it ran in) with no cooperation at all, and takes the
one thing only the caller knows as an argument: `--caption`. An argument fails
in front of whoever typed it.

It rides in a `<image>.transom.json` sidecar rather than the filename, which is
where the TTL rides: a caption holds spaces and slashes, and the name is not
durable anyway — expiry renames a file to `<id>-<zone>`, dropping even its
extension. The sidecar is written **before** the image, because the image
landing is what the watcher triggers on; written after, it would lose the race.
It follows its image into the trash.

**A sidecar answers the caption outright; the filename is read only without
one.** Since `bin/transom` names its copy with a UUID, a fallback to the name
would caption a piped render with a hex string — worse than no caption. So a
sidecar with no caption means the CLI had nothing to say, and the wall shows
nothing. A file dropped in by hand has no sidecar, and its name is the only
thing it says.

**A sidecar names the session that sent it.** `session` and `pid` are
`CLAUDE_CODE_SESSION_ID` and `CLAUDE_PID` from the environment `bin/transom`
ran in, written only inside Claude Code. They are where a drawing on the card
goes back to (*Marking up a render*), and never reach the XMP packet.

**A sidecar naming a group makes the file a take rather than a card.** `group` is
the id `--group` gave it, with `groupLabel` and `of` saying what the group is called
and how many takes are coming. That one field is the whole of the group protocol
at the ingest boundary; everything else about a take — its question, its
`choices`, its `why` box, the `apps` and `links` it offers — is what an ordinary
card can carry too.

**An artifact is a picture, a page, a video or a mesh.** `.png .jpg .jpeg .webp
.gif .avif .tiff .svg` are pictures; `.html` and `.htm` are pages; `.mp4 .m4v .mov
.webm` are videos; `.glb` and `.stl` are meshes. Anything else is skipped
silently, which is also what keeps the sidecar sitting beside every artifact
from being ingested as one. A `.gltf` is refused at the send rather than held:
it is a manifest pointing at sibling `.bin` and texture files, and a send
copies one file.

**An SVG is a picture that is drawn rather than stored.** Its thumbnail is
rasterized at whatever density brings its long edge to the cache's, since
sharp draws one at its declared size and the resize never enlarges. Its size
on the card is the daemon's measurement, not Chrome's, which reports an SVG
with only a `viewBox` as 300×150. The loupe redraws it at the lens's scale
rather than enlarging pixels. `/orig` serves every original under a `sandbox`
CSP: an SVG or a page opened there is a document on the wall's own origin, and
would otherwise be able to script every route the wall has.

**Only a picture has pixels of its own, so the daemon gives the other three
some.** `server/poster.ts` is the one step they go through: headless Chrome
shoots a page, ffmpeg takes a frame of a video, Chrome renders a mesh through
the daemon's own viewer at `/view/mesh`, and a picture is its own poster. What
comes back goes through the picture pipeline unchanged. That is the whole
reason for it — the card, the LOD tiers, the texture budget and the aspect
never learn any of the kinds exists, so nothing in the renderer branches on the
kind.

**A mesh is postered rather than drawn on the wall**, which is this design
declining, for now, to give a card thickness — see the open question below. The
shot is square and transparent, so the model floats on the card rather than
sitting in a box, and it is framed and lit by `shared/mesh.ts`, which the
lightbox reads too: opening a card shows the picture on it turning. A model
that renders to nothing — a load the viewer could not finish — leaves a
perfectly good transparent PNG, so the poster is checked for ink and the
artifact is declined when there is none.

**A page's `w`/`h` are the shot's viewport, not the document's**, which is the
one field whose meaning differs between the kinds. `--screenshot` captures the
viewport and not the page, so a short page leaves a card that is mostly
background; `TRANSOM_SHOT_WIDTH`/`HEIGHT` is where that is traded. A video's are
honest, because ffmpeg writes the poster at the video's own size.

**The only container the wall holds is one the browser can play.** ffmpeg would
poster a `.mkv` happily and the lightbox would then show a dead player, so
`transom` refuses it at the send — and refuses any video at all where ffmpeg is
not on `PATH`, for the reason every send-time check exists: a file the daemon
declines is silently invisible *and* never expires.

The shot is a picture of the page as it was when it landed and is never
retaken. `/orig` keeps serving the source file, so opening a page runs it live
in an iframe rather than showing the shot larger — which is why an HTML
artifact is worth holding at all.

**An animated picture is a still on the wall and plays in the lightbox.** The
cache thumbnail is the first frame — a card is a GPU texture, and a wall of
them playing at once buys motion nobody is looking at — while `/orig` hands the
whole file to an `<img>`, which plays it. So the card wears a `▶` chip in its
bottom-left corner, clear of the age chip and the pin: without it the still
reads as the whole artifact, and a loop that begins where it ends reads as a
broken render. A multi-page TIFF is a still. Frames are counted only where the
file also carries per-frame delays, which is what separates an animation from a
scan.

**A video follows the same rule**, and its card is a poster frame rather than
the first one. The poster is seeked to one second rather
than to frame 0, because a fade-in or a screen recording opens on black often
enough that the first frame is the worse default; anything shorter falls back
to it. `TRANSOM_POSTER_AT` moves the offset.

The badge it wears is the animation's `▶` with its runtime beside it — `▶ 0:12`
— so the card says how much video there is before you spend it. A container
that declares no duration wears the bare glyph.

**Width and height come from the poster, never from ffprobe.** A phone's `.mov`
carries a display matrix: ffmpeg applies it to the frame and ffprobe reports
the stream without it, so trusting ffprobe would transpose every portrait
video. ffprobe is asked for the runtime and nothing else.

**The lightbox opens a video muted, every time, and does not remember
otherwise.** A side monitor that makes noise because of something you did
yesterday is the failure that avoids, and muted is also what keeps Chrome's
autoplay policy from ever blocking the play. The unmute sits in the meta line
beside "open in app", which hands the file to whatever the OS would have used —
the browser cannot call `open`, so `POST /api/items/:id/open` does, and only
ever for a path the store holds.

Nothing is transcoded. `/orig` streams the file as it landed, which
`res.sendFile` already serves by range, so seeking works with no server of its
own.

**Whoever pushes a page says what it may do.** `--sandbox` rides the sidecar
and is applied verbatim to the iframe's `sandbox` attribute; `none` removes the
attribute entirely. A page that says nothing gets `allow-scripts`: it runs, but
it is not same-origin, so it cannot read the wall's stored tuning. The wall
applies what it was told and does not second-guess it, because the pusher is
the only party that knows what the page needs.

**Escape and the arrows belong to the wall, over `window`**, and a keydown
inside a frame never reaches them. So a page lightbox closes on a click in the
margin around its frame — that margin is the only way out once the pointer is
inside the page, and it is why the frame is inset rather than full-bleed.

**`--attention` is the second thing only the caller knows.** It rides the same
sidecar as a raw token — `look`, `30m`, `look:90s`, `until-dismissed` — and the
daemon parses it at ingest into a level and a hold. A token it cannot read is
warned about and dropped rather than guessed at, so a typo never becomes a flag
at the default strength, and `shout` does not start working by accident the day
a second level is added.

The level is a name from the first commit even though only one exists, which is
what makes a second treatment a row in the params table it drives rather than a
change to this contract. **A flag is not a reprieve:** it changes how loudly an
item is drawn and never how long it lives, which is what `--ttl` is for.

A video's original goes unstamped for the same reason a JPEG's does, below.

**The daemon folds the stamp into the image's own XMP at ingest**, both into the
cache derivative and into the original — `/orig` serves the original, and it is
the copy that leaves the wall, where no store is around to ask. **PNG only for
the original:** writing metadata means re-encoding, which is lossless for a PNG
and a silent quality loss for anything else, so a JPEG keeps its bytes and goes
unstamped. The caption is written to `dc:description` as well as the private
`transom:` namespace — but note that macOS does not surface a PNG's XMP
description in Spotlight or Get Info, so the standard field is for the
Adobe-family and `exiftool` readers, not for Finder.

**Ingest is capped at `config.ingestAtOnce`, which bounds buffers rather than
threads.** sharp already runs libvips' own pool at one thread per core and
queues the rest, so an unbounded fan-out was never a parallel decode per file —
its cost was holding every pending full-resolution buffer alive at once.
Adopting an 85-file inbox peaks at 549MB uncapped against 469MB at a cap of 3
(410MB against 330MB for the largest single process), and the gap grows with
the inbox rather than staying flat. `TRANSOM_INGEST_AT_ONCE` overrides it so the
ceiling can be measured instead of argued about.

Stamping restores the file's **mtime** afterwards. `adopt` derives `bornAt`
from mtime precisely so a restart cannot resurrect the wall, so a stamp that
bumps it re-ages every item the daemon re-adopts — and with `tsx watch`
restarting on every server edit, nothing would ever expire while the server is
being worked on.

**The wall is the default in every repo, not something a repo opts into.** Each
harness `CLAUDE.md` says renders go to `bin/transom` and not to Preview, so a repo
is on the wall the first time it renders — no install, no registration, nothing
to forget when a repo is created. Per-repo binding was the earlier model and
scaled the wrong way: eighty repos meant eighty standing instructions to write
and to keep, and repo eighty-one was silently invisible until someone noticed.
The skill (`skills/transom/`, symlinked into the harness skill directories)
now only writes the exceptions — Preview back for one repo, or a zone name that
isn't the directory's.

**Zones self-register, because the daemon needs a path the image doesn't carry.**
A zone colored by its project's `.hued` means mapping a zone back to a working
copy, and the inbox holds only the images. So `bin/transom` writes
`~/transom/zones/<zone>.json` recording the directory it ran in, on every send.
One file per zone rather than a shared registry: two concurrent sends both
read-modify-writing one JSON file lose each other's entry, and the failure looks
like a zone that intermittently forgets its color. A record whose directory has
gone, or that is caught half-written, drops that zone's color and never the
others'.

## A repo's settings

A committed `.transom.yaml` at the repo root changes what a send from that repo
does. Every key is optional and a flag beats the file; `transom wire --repo`
writes a starter with every line commented out.

- **One definition.** `shared/transom.schema.json` is the file's schema. The
  starter's first line points `yaml-language-server` at it by URL, and the site
  serves it there. `transom post` validates against the same schema and stops
  the send on any error, naming each one: a committed typo that did nothing
  would be the silently ignored config this exists to prevent. The schema also
  makes YAML's implicit typing safe, since `zone: 1.10` fails `type: string`
  instead of becoming a number.
- **Read at send time, by node.** `bin/transom` is `sh`, so it asks
  `libexec/settings.mjs` for the file's values and only when there is a file.
  A repo without one sends exactly as before. With one, a send pays node's
  startup: 0.2s measured, 0.12s of it node itself.
- **Applied before the sidecar is written, so the daemon never reads the
  file.** Zone, lifetime and apps fill whatever the flags left blank;
  `attention.loudest` lowers a louder `--attention`, keeping its hold; and
  `sound: false` rides in the sidecar as `quiet`, which keeps a card's level
  and drops only its sound. `marks.unsent` is the exception to come: the queue
  it would choose is unbuilt, and when it is, the daemon reads the file
  through the root each zone record already carries.
- **`show: preview` replaces the exception blocks** that the skill used to
  write into `CLAUDE.local.md`. `transom post` opens the file itself, so the
  global rule never changes: agents always send, and the repo decides what
  sending means. The hook reads the same key and stays quiet there.
- **Read from the main checkout**, like the zone and for the same reason: a
  worktree is named for its own hash.

## Asking for the screen

`--attention` already says how hard an item is asking. What each level *does*
about it is `ALERTS` in `shared/attention.ts`, a row per level beside
`DEFAULT_HOLD`: `lightbox`, `sound`, `notify`, `raise`. An agent writes a level
and gets whatever that level means today, so retuning is an edit here rather
than a change to the ingest contract or to anything an agent has to relearn.

Only `lightbox` is the wall's. The other three are the **daemon's**, and that
split is the whole design: a page cannot play a sound it has not been clicked
for, cannot notify without a permission it may not have been granted, and can
never raise its own window. The daemon is a local process with a shell, so it
can do all three — and it can do them when the wall is not even open.

**`raise` starts the wall if nothing is connected.** The daemon knows, because
the wall is a WebSocket client of its own: `clients.size` is the answer, not a
guess about processes. Connected means bring the browser forward; nothing
connected means launch it, with the same chromeless profile a person would
type. `problem` is the only level that does this — being interrupted is what
that level is for.

An alert is a detached `spawn` whose failure is swallowed. A missing `afplay`
costs the sound, never the arrival.

## Remote senders

A **node** is another Mac on the LAN, such as one of the build Macs, whose
agents send renders to the wall running on this one. `pair` runs on the wall's
Mac and reaches each node over ssh; renders come back over HTTP to the daemon
on `*:8787`.

**`transom pair studio` sets a node up.** Run on the wall's Mac, it installs
or upgrades the tap's release on `studio` with Homebrew (`--head` installs the
tap's HEAD, reinstalling over a release), shows brew's own error when that
fails, says `no Homebrew on studio` when there is none, refuses if the build
cannot send remotely (`transom protocol` does not print
`1`), runs `transom wire` there, writes `~/transom/wall.env`, and has the node
call `GET /api/whoami` to prove it can reach the wall with the token. It is
safe to run again. `transom pair --off studio` deletes `wall.env` and leaves
the install.

**A node is in remote mode while `~/transom/wall.env` exists.** The file is
mode 600:

```
TRANSOM_WALL=http://<wall>.local:8787
TRANSOM_TOKEN=<the wall's ~/transom/token>
```

Only `post`, `ask` and `wait` read it. They behave as they do locally and
print the inbox path on the wall's Mac. Nothing is queued on the node:

| Failure | Exit | Message |
|---|---|---|
| Cannot resolve, connect, or no answer within 3s | 6 | `the wall at <url> is not answering` |
| The wall answered with an error | 1 | `the wall refused this (HTTP <code>): <body>` |
| Anything else | 1 | curl's error and the HTTP code |

The token never appears in a process's arguments: curl reads its headers from a
mode-600 file removed on exit, on the node and in `pair`'s own check.

### The routes

| Route | Does |
|---|---|
| `POST /api/inbox/:zone` | Streams the body into `~/transom/.incoming/`, writes the sidecar into the inbox, then renames the file in — the order ingest expects. The sidecar is base64 JSON in `X-Transom-Sidecar`, at most 12000 bytes encoded; the name's suffix (`.ttl…` and the extension) is `X-Transom-Name`. Returns `{ path }`. Over 2 GB is 413; a video when the wall has no ffmpeg is 422. |
| `GET /api/answers/:name?wait=30` | Returns the answer and deletes it, or 204 once `wait` runs out. `wait` is held to 0–60 seconds. The CLI asks again until it gets one, and keeps waiting through a wall that has gone away. |
| `POST /api/marks/claim` | What the node's hook calls to collect drawings. |
| `GET /api/whoami` | The wall's hostname, for `pair` to check the install. |

**Every route above needs the token from any address but loopback.** The daemon writes a
random token to `~/transom/token` the first time it starts, and sets the file
to mode 600 each time it reads it. A
request without it gets 401 and `this wall wants its token`. The page server on
`:7750` proxies `/api` and adds `X-Forwarded-For`, so a request arriving on
loopback is judged by the last address in that header: a LAN request through
the page server needs the token too. To change the token, delete the file,
restart the daemon, and pair each node again.

`GET /api/marks/<id>.png` stays open: the wall page loads drawings from it, and
it shows nothing `/img` and `/orig` do not.

**Remote requests carry `X-Transom-Protocol: 1`.** On the inbox, answers and
whoami routes a different number gets 426 and `this wall speaks protocol 1, the
sender spoke <n>. Run brew upgrade transom on whichever side is older`, so an
old node fails loudly instead of losing sidecar fields without a word.

**The CLI names its session in `X-Transom-Session`** on every send and every
answer poll, when it runs under Claude Code.

### What changes across hosts

| On one Mac | From a node |
|---|---|
| `zones/<zone>.json` holds the repo's path, and the zone's color comes from that repo's `.hued`. | The sidecar carries the `.hued` text as `hued`, and the zone record keeps it. |
| A sender counts as running while its pid is a live claude process. | The sidecar carries `host`, and the daemon writes `remote` when it has none. The sender counts as running if its session sent, polled for an answer or called `marks/claim` in the last 2 minutes. An `ask` polls every 30 seconds, so a drawing made while it waits answers it. Session ids over 128 characters are ignored, and the daemon remembers at most 1024 sessions. |
| The hook claims drawings when `marks/waiting/<session>` exists. | The hook claims from the wall, as below. |
| `--app Name=path` opens another file. | Dropped with a warning, by the CLI and again by the daemon: a node's path means nothing on the wall's Mac. A bare `--app Name` still opens the sent file there. |
| The CLI refuses a video when it has no ffmpeg. | The daemon checks instead and returns 422. |
| Any zone name. | Letters, digits, `.`, `_` and `-` only. |

**On a node, the hook claims from the wall.** A send writes
`~/transom/remote-sessions/<session>`, and while that exists the hook claims
from `TRANSOM_WALL` on each tool call, with a 2-second timeout. Each drawing is
downloaded into `~/transom/marks/remote/`; one that will not download is handed
to the session as its URL on the wall. When the wall turns the token away (401)
the session is told to run `transom pair <this host>` on the wall.
After any failed claim the hook waits 30 seconds before asking again. It
deletes its markers and drawings after 24 hours.

**Known limits.** After the wall's daemon restarts, the wall treats a node's
session as ended until its next tool call, send or answer poll. An answer is handed
over once: if the connection drops after the wall deleted it, `ask` waits
forever. Anyone holding the token can overwrite `zones/<zone>.json` for any
zone, which changes only its color.

## Rescue, expiry, and the trash

**How long an artifact lives is the daemon's, and the `wall` page of the prefs
sheet sets it.** It is the one setting in that sheet that is not this browser's:
everything else is drawing, saved per browser, while this decides when a file
moves to the trash. It is held in `~/transom/settings.json` as a duration a person
would write — the same `8h` `TRANSOM_TTL` takes — and the environment is only the
fallback for a wall nobody has set. Bounded at a minute and ninety days, since
either end empties the wall or freezes it. A card sent with its own `--ttl`, and
a rescued one, ignore it.

**A zone may set its own, and may take itself off the clock entirely.** Its
sheet offers the same durations plus `indefinite` and `eternal`, both of which
resolve to an infinite lifetime at the sweeper's one comparison, so neither
needs a case of its own. They differ in nothing today and in everything later:
**indefinite is off the clock and ordinary otherwise**, so the reaper's disk
cap takes it like anything else, while **eternal is exempt from all of that** —
the zone-wide form of a rescue. Bulk expiry and the reaper pass over an eternal
zone; the card's own Expire is a deliberate act on one artifact and still
lands.

A zone's lifetime is written to `zones.json` the way a person would — `8h`, or
the hold's own word — and a record this build cannot read leaves the zone
inheriting.

**Pinning a card — the menu's Pin — takes it off the clock where it stands.**
`keptAt` freezes its age, so it keeps the brightness it had while everything
around it fades, and neither the sweeper nor startup adoption trashes it. The
rescue is written to the sidecar as `kept`, because adoption re-reads sidecars
and a keep held only in memory would let the file expire on the next daemon
restart. The file does not move: it is safe from the wall, not from `rm`.

**Unbuilt: the keep set has no bound, and pinned cards have no band of their
own.**

- **The bound.** The keep set holds N (start at 12), and pinning when it is full
  means choosing what the new one displaces — the menu is where that choice
  surfaces. Without a bound, "permanence earned by attention" collapses into one
  click and forever, and one click is not attention: the sediment folder comes
  back with extra steps. It waits on living with a wall that can rescue at all,
  since twelve is a guess about a pressure nobody has felt yet.
- **The reserved band.** Pinned cards leave the flowing set for a band of their
  own, and the flowing set arranges in the space that is left — one rule for
  every arrangement, rather than each packing around a hole. Today a pinned card
  stays in its pile at its rank, set apart only by its frozen fade.

**Expiry moves a card to a holding trash, kept for 24 hours.** The real loss
mode is being heads-down for 40 minutes, not glancing up as something dies; a
10-minute trash catches almost none of those and only feels like a safety net.

**The reaper keeps the directories below within bounds.** It runs once the inbox
present at startup has been taken in — before that the store is empty and
every thumbnail would look orphaned — and then every 10 minutes. Each limit
with a variable can be set in the daemon's environment.

| What | Rule | Variable |
|---|---|---|
| `inbox/` and `.cache` together | Over 20 GB (`0` reads as unset), expire the oldest cards through normal expiry, so they go to the trash and the wall animates them away. Pinned cards, open questions, cards with undelivered drawings and eternal zones are never taken; `indefinite` ones are. Each card is checked again just before it goes. | `TRANSOM_WALL_MAX` |
| `trash/` | Delete what has been there longer than 24 hours, then the oldest until it is under 10 GB. | `TRANSOM_TRASH_TTL`, `TRANSOM_TRASH_MAX` |
| `.cache` | Delete a thumbnail or poster no card uses, once it is an hour old: ingest writes it before the store holds the card. | — |
| `answers/` | Delete an answer no CLI collected within 24 hours. | — |
| `inbox/<zone>/`, `zones/<zone>.json` | Remove a zone folder that has sat empty for 24 hours, then the record of any zone left without a folder. The next send recreates both. | — |
| `.incoming/` | Delete a remote upload cut off partway, after an hour. | — |
| `marks/` | Delete records and drawings for cards no longer on the wall, after the trash's 24 hours. `marks/remote/` is the hook's, and it prunes that itself. | — |
| `~/.local/state/transom/*.log` | Over 25 MB, copy to `<name>.1` and truncate in place. | `TRANSOM_LOG_MAX` |

**Age is the later of a file's mtime and ctime.** Moving a card into the trash
keeps its mtime and bumps its ctime, so mtime alone would age it by when it was
rendered rather than when it was thrown away. Truncating a log in place is safe
only because launchd opens it with `O_APPEND`; a writer without that keeps its
offset and leaves a sparse file.

A file that will not delete is logged as `[reap] could not delete` and
skipped, so one stuck file never stops a pass. A log that cannot be rotated is
logged and skipped too. When the cards it may not take
hold more than the cap on their own, nothing more can be evicted: `/api/health`
reports the sizes, and the band shows a `disk` chip until it fits.

**The last ten expiries a person asked for are undoable with a keystroke** —
Delete in the lightbox, the menu's expiries, a whole zone as one step — never a
TTL running out, which would bury them within the second. That covers the case
the trash doesn't: seeing it go and wanting it back immediately.

**Hover pauses decay.** Otherwise things vanish while you're looking at them.

**Never show a countdown.** No numbers, no ticking. If the wall reads as "act now
or lose this," everything gets pinned defensively and you are back to sediment.
The arrangement carries decay peripherally or it doesn't work.

## The lab and the wall

The page is two things: the wall a room looks at, and the lab a person tunes it
from. `?lab` is the whole difference — off by default, read once at boot and
never persisted, so the URL launchd opens comes back clean after every reload
and a session that wants to tune types the flag.

**On the wall always:** the sidebar and its flag list, the filter band, the
minimap, the right-click menu, the lightbox, the `?` modal, and the HUD's
`offline`. Every one of them answers "what is asking to be looked at" or "show
me that one", and the last four are reachable only by a hand already at the
machine, so they cost a room-facing wall nothing by existing.

**The debug section fabricates real artifacts, not fake ones.** Its row of
alert buttons fires the daemon's own treatment; its synth buttons write an
actual file and sidecar into a `debug` zone on a 20-minute TTL — a group of takes,
a card with a question, or one already answered. A card fabricated in the browser
could not be answered at all, because its id reaches no daemon, and a carousel
nobody can click says nothing about the carousel. The answered one exists
because that is the one state clicking cannot reach: answering is the thing
being looked at. The TTL is what keeps a session of them from becoming litter.

**Behind `?lab`:** the sidebar's debug and params sections, the `,` preferences
modal, the axes gizmo, the HUD's arrangement name — a constant now that
`arrangements` holds one entry — and the stats block when it is built. A tuning
the lab stored still governs the wall: `mergeStored` runs whether or not a panel
is on screen.

**A flag, not a build.** The wall is served from localhost to one machine, so a
lighter bundle buys nothing, and what the split is for is what is on screen. A
second vite entry would split dev iteration in two and make `transom install` choose a
build, for no gain that a room can see.

## Traps

**Partial writes.** A watcher reports a file on creation, not on completion, so
a streaming write hands `sharp` a truncated PNG. `watchTree` holds a file until
its size stops changing — `some-generator | transom post` is exactly this case.
Without that wait a fraction of images arrive corrupt, intermittently, and it is
miserable to diagnose later.

**A watcher is an optimization, never the only way in.** chokidar has shipped
without `fsevents` since v4, so on macOS it registers a separate `fs.watch` per
watched path: 211 images and their sidecars cost 422 descriptors, growing with
the wall rather than with the number of zones. An exhausted table does not
present as a watcher fault — libuv cannot allocate child-stdio pipes either, so
the page shot and the wall browser start failing to spawn, and brainhouse chased
that as a spawn race for a month before finding the watcher. It also loses a
file written into a zone between its scan and its watch registration
([#1471](https://github.com/paulmillr/chokidar/issues/1471), open), which is how
two artifacts sat unseen in the inbox for an evening with no error anywhere. So
macOS and Windows use the OS's recursive watcher and `inboxSweep` re-offers
whatever the store lacks. chokidar stays for Linux, where it is inotify and was
never the descriptor bomb.

**Texture memory is budgeted in bytes, not count.** A 2048² RGBA texture is 16MB
and a 2048×512 is 4MB; a per-zone item cap bounds nothing. Evict against a byte
budget, add ~33% for mipmaps, and explicitly `.dispose()` evicted textures — GC
will not reclaim them. A few hundred full-res textures will exhaust VRAM and take
the compositor with them: stutter, then black planes, then a hang.

**WebGL context loss.** A backgrounded app window can lose its GL context even
with a separate profile. Without a `webglcontextlost` handler the wall goes black
overnight and reads as a crash. Handle it and rebuild.

**The watcher and synth tests are timing budgets, so a loaded box fails them.**
`server/watchTree`, `server/watchInbox` and `server/synth` wait on a real file
landing through a real watcher, or on sharp writing real PNGs, against a 4s
`waitFor` and vitest's 5s default. `vitest run` spawns a worker per file — 101
of them — so on a machine already busy the failures wander between those three
files from run to run and each one passes alone. A wandering set is contention,
not a regression; run the file on its own before believing it.

**Idle.** As described the wall renders at 60fps forever at a monitor nobody is
watching. Drop to a low tick when nothing is animating and no pointer is present.

**`res.sendFile` ignores dotfiles by default**, so serving the cache out of
`~/transom/.cache` 404s every image with no hint as to why. Both file routes pass
`{ dotfiles: 'allow' }`.

**An empty model unwinds the view to the wall.** The focused zone is pruned
when it stops appearing in what the daemon sends, and a websocket reconnect
sends nothing for a frame — so a dropped connection reads as the wall spontaneously
zooming out. Harmless and self-correcting, and indistinguishable from a bug.

**A delamin8r plane flattens without a word.** `overflow` other than
`visible`, `opacity` below 1, or a `filter` or `backdrop-filter` on any ancestor
takes a plane out of 3D while its computed `transform-style` still reads
`preserve-3d` — which is why the menu's card name has no line clamp. In dev the
band, the menu and the prefs sheet ask `handle.diagnose()` and warn for each.

**Serve images as URLs, never over the socket.** Push paths; let the client
fetch. That gets HTTP caching and off-main-thread decode via `createImageBitmap`.
Base64-over-WebSocket hitches every time a render lands.

## Rejected

| Considered | Verdict |
|---|---|
| Preview + `open -g` | Stopgap only. `-g` stops the focus theft today, but windows still pile up. |
| Electron | Rejected. Its only real advantage was non-activating floating windows over the work area, and a full-monitor wall never comes forward. Would still need the same daemon. |
| Swift + Metal | Rejected for now. WebGL already goes through ANGLE onto Metal; GPU isn't the bottleneck. The interaction model is unsettled and React hot-reload beats a renderer rewrite. |
| Core Animation instead of Metal | Noted for a future native port. `CALayer` + `CATransform3D` + `sublayerTransform` gets a receding wall with no renderer. Metal is overkill at a few hundred quads. |
| Native `NSPanel` hosting `WKWebView` | Only if cards ever need to float over the primary display. Correct window semantics, keeps React, ~200 lines of Swift written once. |
| File System Access API (no daemon) | Rejected. No change notification, so you'd poll on an interval and re-consent every browser restart. The daemon is less code. |
| `zoneGrid.padding` | Retired. windease insets the cells correctly, but a card's size comes from `side` in world units, so cards do not shrink with their cells: raising it moved the anchors together while the cards stayed put, and the piles collided. `camera.margins[0]` already owns breathing room around the wall, in the one place that survives framing the union. |
| The lightbox in WebGL, the camera flying to a card | Rejected. WebGL and the DOM disagree on color management, so the handoff to real pixels pops; a 6000×4000 original is 96 MB of VRAM where an `<img>` costs the texture budget nothing; and a GL quad loses the browser's save, copy, drag to Finder and true 1:1. |
| Depth from `age01` rather than rank | Rejected. Spacing would encode arrival timing: bursts clump and quiet spells leave gaps. |
| A slow automatic camera drift, for parallax | Rejected. Motion nobody asked for, on a monitor nobody is watching. |
| weasel's `Timeline` as the band's time control | Rejected. It is a keyframe editor — tracks, a playhead, easing handles — and does not survive contact with a time-range brush. |
| HTML/React artifacts on the wall, not just images | Rejected. A CSS3D or iframe layer means no depth sorting against WebGL planes, no shared fade, no texture control, and arbitrary JS running on the wall. If HTML artifacts want a wall, they want a different one. |
| The zone backdrop as tinted glass, shading what sits behind it | Rejected. Dropping the backdrop's `renderOrder = -1` would let it sort by its own z and tint everything behind — but at `BACKDROP_Z` that is the zone's own pile from rank 1 back, not just the strangers, and at a `backdropOpacity` of 0.5 it is a wash rather than a hint. Sparing the home pile needs per-zone masking or a stencil. The `distance` falloff answers the same complaint per-card and tunably, so the plane stays a background. |

## Open questions

- **Arrival rate.** Gates everything downstream. At 3/hour there is no packing
  problem, no memory problem, no zones, and the whole arrangement layer is
  decoration. At 200/hour the wall is a blur and nothing reads at any depth.
  Measured from the daemon log, Sep 7 – Oct 8 2026: 18,816 arrivals, about 25
  an hour averaged over the clock, with a busiest hour of at least 74 (read off
  the trash's mtimes, so live cards are missing from it). Three zones — `astv`,
  `weasel`, `brick-icons` — sent 59% of them. The log's lines carry a
  timestamp from Oct 8, so peaks can now be read directly rather than bounded.
- **Does anything on the wall have thickness?** Every primitive is a flat plane
  today — cards, zone outlines, labels — while a pile occupies a volume many
  times the wall's own height. The `mesh` kind arrived and did *not* settle
  this: its card is a rendered poster and the real geometry lives in the
  lightbox, so the wall is still flat and the question is still open. Two separable calls. Whether a *card* gets
  thickness is ours alone: `TransomChannels` is transom's own vocabulary that
  windease carries and never reads, so a depth channel costs nothing upstream.
  Whether a *zone* gets a depth is a change to windease's `Rect`, and is the one
  that would let the camera frame a pile instead of its front face. Neither is
  needed while the wall is read head-on.
- **Threaded questions.** A question is one-shot today: one answer and the card
  goes back to ordinary. A thread would let the agent follow up on the same
  card, and needs a history in the lightbox and a way to mark it resolved. Worth
  it only if follow-ups keep arriving as new cards.
- **Most of `/api` still answers the whole LAN without the token.** Sending,
  answers, `whoami` and `POST /api/marks/claim` need it (*Remote senders*).
  Everything else takes requests from any host, including
  `POST /api/items/:id/open`, which runs `open -a` on the wall host. Whether
  the rest follow, with the wall page exempt by loopback, is undecided.
- **Multi-monitor.** Does a zone ever span displays, or is one board one screen?
- **Where unsent marks go when their session has gone — TODO, deliberately
  unbuilt.** Today a drawing whose sender has exited stays on its card until
  the viewer discards it (see *Marking up a render*). A queue that hands it to
  a later session in the same repo is the other answer. A repo will choose
  with `marks.unsent` in its `.transom.yaml` (*A repo's settings*), which takes
  only `keep` until the queue exists; the daemon reads that key through the
  zone record's root.

## Running it

```
npm install
npm run dev                                   # daemon :8787 + client :7750
npm run sim -- --rate=600 --count=40          # arrivals/hour; count 0 = forever
TRANSOM_TTL=90 npm run dev                       # seconds; the fallback before
                                              # the prefs sheet sets one
```

`sim` writes real files into `~/transom/inbox/<zone>/` in chunks, so it exercises
the whole path an agent would — including the partial-write guard.

## Build order

1. ~~Daemon + snapshot-on-connect + a first arrangement.~~ **Done.**
2. ~~Sim mode.~~ **Done.**
3. ~~Point one agent at `~/transom/inbox/` and live with it for a day.~~ **Done**
   — every agent has sent for a month; see *Arrival rate* under *Open questions*.
4. r3f backend, `stack`, and zones — see *Arrangements*. Zones arrive
   here rather than last, because one pile per zone is what `stack` is.
5. ~~The remaining flat arrangements.~~ **Dropped** with the DOM backend, which
   step 4 made redundant. `[` / `]` still cycles, over a set of one.
6. Rescue, expiry, trash, undo. **Partly done** — pinning, expire-now and a
   ten-deep undo ship with the right-click menu; the capacity bound and the
   reserved band do not. See *Rescue, expiry, and the trash*.
7. Arrival motion. An artifact that just landed looks exactly like one that has
   been up an hour, minus its age chip. `bloom` (*Entry behavior is a separate
   axis*) is the designed answer but pulls the other way — it exists to make an
   arrival quieter rather than to mark it, and which of the two the wall wants
   is unsettled.

8. ~~A `video` kind.~~ **Done.** `.mp4 .m4v .mov .webm` land as a poster frame
   wearing `▶ 0:12` and play in the lightbox. The call the design wanted made
   first was whether a card may *move*, and it went against: forty looping
   videos is a different object from forty stills, so the card stays a still
   and only the lightbox plays. See *Ingest contract*.
9. ~~A `mesh` kind.~~ **Done.** `.glb` and `.stl` land as a rendered
   three-quarter view on a transparent card wearing `⬡`, and open into a
   lightbox that orbits the real model. The card is a poster and not geometry:
   the quad pipeline — LOD, fade, depth sort, texture budget — assumes a
   picture, and a card holding a model opts out of all of it at once. The wall
   lights every model itself, so two are in the same room; the meta line reports
   the format and the file size rather than a triangle count. See *Ingest
   contract*.
10. ~~Remote senders and a bounded disk.~~ **Done.** See *Remote senders* and
    *Rescue, expiry, and the trash*.
11. Split the files that grew past a few hundred lines: `server/store.ts`
    (eviction and the marks bookkeeping can each own a module),
    `server/index.ts` (the routes into mount functions, as `server/remote.ts`
    already is) and `bin/transom`.

Steps 1–3 are cheap and answer most of the open questions.
