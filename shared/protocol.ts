import type { Attention, Level } from './attention.ts'
import type { Build } from './build.ts'
import type { Backdrop } from './backdrops.ts'
import type { Lifetime } from './lifetime.ts'

/**
 * How a question closed. `choice` is the chip that was clicked, absent for a
 * free-text answer and for every way of closing without one; `text` is the
 * free-text box, empty unless something was typed in it. A question offering
 * choices *and* a box answers with both. `marked` means the viewer drew on the
 * picture instead and pressed *No, like this*; `text` is what they wrote.
 */
export type Reply = {
  status: 'answered' | 'dismissed' | 'expired' | 'marked'
  choice?: string
  text: string
  at: number
}

/** An app the sender offered, by `open -a` name, and the file to hand it. The
 *  wall may ask the daemon for one of these and no other. */
export type TakeApp = { name: string; path: string }

/** Somewhere on the web the sender says this take is about. `http(s)` only. */
export type TakeLink = { label: string; url: string }

/**
 * One member of a group: a picture with its own question, reviewed in the
 * carousel the group's card opens into.
 *
 * Not `frames` — `WallItem.frames` already means how many an animated picture
 * plays, and one word for two quantities would make the badge a guess.
 */
export type Take = {
  id: string
  url: string
  origUrl: string
  /** The source file's own name, as a picture's `name` is. */
  name: string
  /** The source file on disk, for Copy path and for the daemon's `open`. */
  path: string
  at: number
  w: number
  h: number
  question?: string
  choices?: string[]
  /** The free-text box's placeholder. Absent means the take offers no box. */
  why?: string
  reply?: Reply
  markup?: Markup
  apps?: TakeApp[]
  links?: TakeLink[]
}

/**
 * A picture the viewer drew on and sent back with *No, like this*, flattened
 * onto the render. One per artifact: drawing again replaces it.
 *
 * `pending` has not reached the session that sent the card, and holds the card
 * off the clock until it does or is discarded. `delivered` says how it got
 * there: as the reply to a waiting `transom ask`, or through the hook at that
 * session's next tool call. `discarded` was thrown away on the wall.
 */
export type Markup = {
  status: 'pending' | 'delivered' | 'discarded'
  text: string
  /** When it was sent from the wall. */
  at: number
  /** When it stopped being pending. */
  resolvedAt?: number
  via?: 'ask' | 'hook'
  /** The composite, served by the daemon. */
  url: string
  /** Whether the session that sent the card was still running when the daemon
   *  last looked. False while pending means nothing will collect it: no session
   *  was recorded, or it has exited. */
  live: boolean
}

/** What a group's card draws, derived from its takes: the first unanswered, else
 *  the last. The store recomputes it, so no renderer holds the rule. */
export type Poster = { url: string; origUrl: string; w: number; h: number }

export type WallItem = {
  id: string
  url: string
  origUrl: string
  zone: string
  /** The source file's own name, less its TTL segment and extension. The
   *  closest thing to a caption an agent already writes. */
  name: string
  bornAt: number
  /** Overrides the wall's default TTL. Absent means the default applies. */
  ttlMs?: number
  /** Set when the item asks to be looked at. Absent is the ordinary case. */
  attention?: Attention
  /** When it was rescued. Present means the sweeper leaves it alone and its
   *  decay is frozen at this moment. */
  keptAt?: number
  /** The source file on disk. What "copy path" puts on the clipboard, so the
   *  wall answers a question the terminal can act on. */
  path: string
  /** The badge a flagged item wears. Absent means it wears none. */
  note?: string
  /** A question the agent asked. Open while `reply` is absent; once closed it
   *  stays on the card, inert, beside its reply. `choices` absent means the
   *  answer is free text. */
  question?: string
  choices?: string[]
  reply?: Reply
  /** A drawing sent back from the lightbox. A group carries these per take. */
  markup?: Markup
  /** What `bin/transom` saw when it ran: the repository and the short commit.
   *  Absent for anything dropped in by hand. */
  repo?: string
  sha?: string
  /** Absent for a picture, which is the ordinary case. `page` means `/orig`
   *  serves an HTML file the lightbox runs; `video` means it serves a video
   *  the lightbox plays; `mesh` means it serves a model the lightbox orbits;
   *  `group` means the card stands for many pictures and the lightbox pages
   *  them. Any of the four leaves `url` a poster of it. */
  kind?: 'page' | 'video' | 'mesh' | 'group'
  /** A group's members, in arrival order. Only ever set with `kind: 'group'`, and
   *  never empty — a group's card is opened by its first take. */
  takes?: Take[]
  /** What the group said about itself. `of` is how many takes are coming, where
   *  the sender knew; absent means the count so far is all that is known. */
  group?: { label?: string; of?: number }
  /** How many frames an animated picture plays: the wall draws the first and
   *  the lightbox plays all of them. Absent for a still, and for a video,
   *  which reports its runtime instead. */
  frames?: number
  /** How long a video runs, in ms. Absent for everything else, and for a
   *  container that declares no duration — which some `.webm` do not. */
  duration?: number
  /** The source file's size. Set for a mesh, which is the one artifact whose
   *  own pixel size says nothing about it — its `w`/`h` are the poster's. */
  bytes?: number
  /** What the pusher said the page may do, verbatim into the iframe's
   *  `sandbox` attribute. Absent means the wall's own default applies. */
  sandbox?: string
  /** Apps the sender offered and pages it points at. A group carries these per
   *  take, since each one is about a different render. */
  apps?: TakeApp[]
  links?: TakeLink[]
  /** Its level stands but its sound never plays: the repo it came from said
   *  so in `.transom.yaml`. */
  quiet?: true
  /** The pixels behind the card. For a picture that is its own size, which is
   *  what `/orig` serves — not the cache thumbnail's, which is capped at
   *  `maxEdge`. For a page it is the shot's viewport, since the document has
   *  no size of its own; the two kinds differ here and nowhere else. */
  w: number
  h: number
}

/** How often the daemon beats. A socket vite proxies stays open at the
 *  browser's end when the daemon dies, so the wall listens for silence. */
export const BEAT_MS = 5000

/**
 * Why the wall just made a noise. The daemon plays the sound, so only the
 * daemon knows a sound was played; this is it saying so, with where the
 * arrival came from and what it wants, for a toast on the wall.
 */
export type Alert = {
  id: string
  zone: string
  level: Level
  /** The question if there is one, else the note, else the item's name. */
  asks: string
  name: string
  repo?: string
  sha?: string
}

/**
 * What one zone overrides about itself. Every field is absent by default and
 * absent means inherit — the wall's backdrop, the wall's lifetime, the color
 * the daemon read off the project's `.hued`. A zone that has never been
 * configured has no entry at all.
 */
export type ZoneSettings = {
  /** Wins over the `.hued` color. Cleared to fall back to the project again. */
  color?: string
  backdrop?: Backdrop
  /** The pattern's pitch in world units, which the sheet offers as a density —
   *  the smaller the number, the denser the ruling. Wins over the wall's. */
  spacing?: number
  /** The pitch along the other axis, for the patterns that have one. Wins
   *  over the wall's, and is ignored by every pattern ruled one way. */
  period?: number
  /** What the ruling is turned to, in degrees. Wins over the wall's. */
  angle?: number
  /** How long an artifact here lives when it carries no TTL of its own. A
   *  duration, or one of the two ways of being off the clock. */
  lifetime?: Lifetime
}

/** What the wall holds on disk, from the reaper's last pass. `over` means the
 *  cards it may not evict alone exceed the cap. */
export type Disk = { wallBytes: number; wallMax: number; trashBytes: number; over: boolean }

export type ServerMessage =
  | {
      type: 'snapshot'
      now: number
      ttlMs: number
      items: WallItem[]
      /** Zone name to the color of the project bound to it, where one has a
       *  `.hued`. Only the daemon can read those files. */
      zoneColors: Record<string, string>
      /** Zone name to when it was pinned, for the zones held at the top of
       *  the wall. A zone that is not held has no entry. */
      pinnedZones: Record<string, number>
      /** Zone name to what that zone overrides. Most zones have no entry. */
      zoneSettings: Record<string, ZoneSettings>
      /** What code the daemon is running. The wall compares it to its own and
       *  says so when they disagree — the daemon is a LaunchAgent and does not
       *  reload, so it can serve yesterday's build with no sign at all. */
      build: Build
      /** The reaper's last pass, or null before its first. */
      disk: Disk | null
    }
  | { type: 'zoneColors'; zoneColors: Record<string, string> }
  | { type: 'disk'; disk: Disk }
  /** One zone's overrides, as someone just set them. An empty object means the
   *  zone went back to inheriting everything. */
  | { type: 'zoneSettings'; zone: string; settings: ZoneSettings }
  | { type: 'arrive'; item: WallItem }
  | { type: 'expire'; id: string }
  /** The item is still on the wall; it has just stopped asking to be looked at. */
  | { type: 'dismiss'; id: string }
  /** A take appended to a group already on the wall — the one thing that changes
   *  an item's pixels after it lands, so the recomputed poster rides with it. */
  | { type: 'take'; id: string; take: Take; poster: Poster }
  /** A question closed. Its flag goes with it; the question stays. `take` names
   *  which member of a group answered, and the poster moves on to the next
   *  unanswered one. */
  | { type: 'reply'; id: string; reply: Reply; take?: string; poster?: Poster }
  /** A drawing sent back, delivered, discarded, or its sender found gone.
   *  `take` names which member of a group it is on. */
  | { type: 'markup'; id: string; markup: Markup; take?: string }
  /** Rescued, or let go again. `keptAt` is null for the second. */
  | { type: 'keep'; id: string; keptAt: number | null }
  /** A zone held at the top of the wall, or let back into the order.
   *  `pinnedAt` is null for the second. */
  | { type: 'zonePin'; zone: string; pinnedAt: number | null }
  /** The daemon played a sound for this arrival. */
  | { type: 'alert'; alert: Alert }
  /** How long an artifact lives from now on, as someone just set it. */
  | { type: 'ttl'; ttlMs: number }
  /** Nothing happened, and the daemon is still here to say so. */
  | { type: 'beat' }
