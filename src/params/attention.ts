import type { Level } from '@shared/attention.ts'

/** How one attention level is drawn. */
export type AttentionLevel = {
  /** World units toward the viewer, in front of the pile's own front rank. */
  lift: number
  /** Screen pixels, like the other line widths. 0 draws no halo. */
  haloWidth: number
  /** Half the peak-to-peak scale swing. 0 is no pulse. */
  pulseAmp: number
  /** Beats per second. Urgency reads as rate before it reads as size, so this
   *  climbs with the level rather than being one rhythm for the wall. */
  pulseHz: number
}

export type AttentionParams = {
  /**
   * How an item that asks to be looked at gets said. One strength drives all
   * three cues, so they cannot drift apart, and the wall reads the same
   * whether a flag is fresh or about to lapse.
   */
  attention: {
    /** Master gain over every level's pulse. Off by default: the wall earns
     *  its calm, and motion is the one cue that cannot be ignored on purpose. */
    pulse: number
    /** World height of a badge's text, like a zone label's. */
    badgeSize: number
    /** How much a flagged artifact grows under the pointer. In place: it swells
     *  where it stands rather than coming toward the camera, so hovering never
     *  reorders what is in front of what. */
    hoverScale: number
    /** What the hover multiplies its halo by. */
    hoverEdge: number
    /** Badges rise to a shelf above their zone and run a line back down to the
     *  artifact they belong to, rather than sitting welded to its top border.
     *  Welded is unreadable the moment two flagged artifacts share a pile: the
     *  nearer plate buries the deeper one. */
    float: boolean
    /** How far the lowest shelf sits above the zone's top border. Zero by
     *  default, so a pile with one flagged artifact reads exactly as it did
     *  welded and only a second plate has to climb. */
    floatLift: number
    /** Space between two plates on the same shelf. */
    floatGap: number
    /** Width of the line back to the artifact, in screen pixels. */
    leaderWidth: number
    /** A badge faces the camera, whatever its card does. Off, it lies in its
     *  card's own plane and turns with the wall, reading as a face of the
     *  artifact rather than a label on it. */
    billboard: boolean
    /** A leader line turns only at right angles: it leaves its plate straight
     *  and takes one bend to reach the card, rather than running diagonally. */
    leaderElbow: boolean
    /** Each pile's plates stand together as a ladder that steps the way the
     *  pile does, on whichever side of it the whole wall scores best, rather
     *  than stacking on the zone's top border. */
    seek: boolean
    /** How often the hunt runs, in ms. Not every frame: the answer would
     *  change under a moving camera and the plates would crawl. */
    seekMs: number
    /** How many plate-widths out from its pile a group may stand. */
    seekReach: number
    /** What a plate pays for standing wholly over a card; a partial cover
     *  pays its share, and every card under it charges. This is what
     *  whitespace is worth, and what a leader line is traded against. */
    seekCover: number
    /** What a plate pays per screen height of leader line, against the
     *  cover it saves by standing further out. Zero lets a group stand
     *  anywhere empty however far that is from its pile. */
    seekPull: number
    /** What a plate pays for needing a line back to its artifact at all. Only
     *  the lone plate of a front card can rest on it and need none, so this is
     *  what keeps that one welded unless standing off buys more than the line
     *  costs. */
    seekLineCost: number
    /** What a plate pays for standing wholly on another zone's cell, empty or
     *  not; a partial cover pays its share. Another zone's ground is not
     *  whitespace, but it beats covering a picture. */
    seekForeign: number
    /** What a pile pays for standing its plates on a side the other piles do
     *  not. This is what makes the wall read as one layout rather than as a
     *  handful of piles each solving for itself. */
    seekMismatch: number
    /** What a plate pays for a line that leans away from the lines of the
     *  other plates in its pile: nothing parallel, twice this perpendicular.
     *  Lines that run the same way read as one gesture; a fan of them reads
     *  as a tangle. */
    seekParallel: number
    /** The same, per pile, for leaning away from the wall's lines. */
    seekAlign: number
    /** What a pile pays for its ladder standing apart from every other rather
     *  than directly above or below one, so ladders read as one list down the
     *  wall. Nothing when touching, all of it eight plate heights away or with
     *  no ladder sharing any of its span. Same x is never asked for. */
    seekStack: number
    /** What a pile pays for standing its plates on a side where the deeper
     *  cards' edges are hidden under the front card. A pile stepping up and
     *  left shows every card's top and left edge, and that is where a plate
     *  can point at the card it belongs to. Mild by default. */
    seekExposed: number
    /** The share of its score a new layout must beat the held one by before
     *  the wall leaves it. A share rather than a sum: zooming scales every
     *  score together, so zoom alone is never a reason to move. */
    seekSettle: number
    /** The spring pulling a plate toward the spot it has chosen. A plate is
     *  never moved outright: it is driven there, so a wall settling reads as
     *  motion rather than as a jump. */
    seekStiffness: number
    /** Damping on that spring. Around twice the square root of the stiffness
     *  arrives without overshooting; below that a plate bounces. */
    seekDamping: number
    /** One row per level, which is what makes a fifth level a row here rather
     *  than a change to the ingest contract. */
    levels: Record<Level, AttentionLevel>
  }
}

export const attentionDefaults: AttentionParams = {
  attention: {
    pulse: 0,
    badgeSize: 0.026,
    hoverScale: 1.07,
    hoverEdge: 1.8,
    float: true,
    billboard: true,
    leaderElbow: false,
    floatLift: 0,
    floatGap: 0.012,
    leaderWidth: 1.5,
    seek: true,
    seekMs: 220,
    seekReach: 3,
    seekCover: 300,
    seekPull: 90,
    seekLineCost: 140,
    seekForeign: 200,
    seekMismatch: 80,
    seekParallel: 120,
    seekAlign: 40,
    seekStack: 60,
    seekExposed: 40,
    seekSettle: 0.25,
    seekStiffness: 26,
    seekDamping: 10,
    levels: {
      look: {
      // A bookmark, not an alarm: findable while scanning and quiet enough
      // that a wall of them stays calm, and still enough not to nag.
        lift: 0.06,
        haloWidth: 1.5,
        pulseAmp: 0,
        pulseHz: 0,
      },
      soon: {
        lift: 0.16,
        haloWidth: 2.5,
        pulseAmp: 0.012,
        pulseHz: 0.35,
      },
      urgent: {
        lift: 0.4,
        haloWidth: 4,
        pulseAmp: 0.05,
        pulseHz: 0.9,
      },
      problem: {
        lift: 0.4,
        haloWidth: 4,
        pulseAmp: 0.05,
        pulseHz: 1.4,
      },
    },
  },
}
