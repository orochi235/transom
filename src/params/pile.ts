export type PileParams = {
  /** The few settings worth finding first, whatever they govern. First in the
   *  type so it is the first group in the sheet and the first tab in its
   *  column. */
  general: {
    /** The app-wide parallax gate, over each surface's own flag: the band, the
     *  card menu, the `?` card and the prefs sheet all stop when this is off.
     *  A master switch rather than a replacement, so a surface tuned off stays
     *  off when this comes back on. */
    parallax: boolean
  }
  /** Per-rank offset within a pile, in world units. z is negative: away. */
  step: { x: number; y: number; z: number }
  /** Constant world side of each item's square slot. */
  side: number
  /**
   * Where a pile hangs in its cell, 0..1 on each axis. The same relative point
   * of the card meets that point of the cell, so 0,0 is top-left corner to
   * top-left corner and 0.5,0.5 is centered.
   */
  origin: { x: number; y: number }
  /** Constant card angles, radians. */
  rot: { x: number; y: number }
  /** Deterministic per-id jitter, radians and world units. */
  jitter: { rot: number; pos: number }
  /** How long a rank change takes to animate. */
  shoveMs: number
  /** age01 window over which an item fades out. */
  fade: { from: number; to: number }
  /**
   * Presence falling off with depth, which is the other half of what the LOD
   * tiers already do: detail drops with rank, and without this luminance does
   * not, so a buried card reads as blocky and loud at once.
   */
  distance: {
    /** Off is the wall before this existed: depth changes detail and nothing else. */
    enabled: boolean
    /**
     * Rank window over which presence falls from full to `floor`. Ranks rather
     * than world z, so the window holds its meaning while `step.z` is tuned.
     */
    from: number
    to: number
    /** Where the tail settles. Never 0: an invisible tail is a shorter pile. */
    floor: number
    /**
     * How the falloff meets the temporal fade. Both take a fully expired card
     * to nothing; they disagree while one is running. `ceiling` scales age's
     * presence by depth's, so the two compound and a deep old card is dimmer
     * than either alone. `min` takes whichever is dimmer, so a deep card holds
     * at the floor and ignores its fade until age drops past it.
     */
    combine: 'ceiling' | 'min'
  }
  /**
   * Small readouts standing in a corner: how old the front of a pile is, how
   * many artifacts a zone holds. Both answer a question the wall could only be
   * asked by walking up to it.
   */
  chips: {
    /** An age chip on the front card of every pile. */
    cards: boolean
    /** A count chip on every zone. */
    zones: boolean
    /** World height of a chip, whichever it is. */
    size: number
    /** What fraction of `size` a chip keeps once the view is inside a zone. A
     *  chip that held its world size would swell as the camera closed in,
     *  because the card it annotates is what gets bigger, not the note. */
    shrink: number
    /** How far the age chip sits inside its artifact's top-left corner. */
    inset: number
    /** How far a zone's count runs past the corner it marks, along the
     *  diagonal. Centered on the corner point, so zero is the straddle. */
    bleed: number
  }
}

export const pileDefaults: PileParams = {
  general: {
    parallax: true,
  },
  step: {
    x: -0.013,
    y: -0.009,
    z: -0.023,
  },
  side: 0.305,
  origin: {
    x: 0,
    y: 0,
  },
  rot: {
    x: -0.12,
    y: 0.34,
  },
  jitter: {
    rot: 0,
    pos: 0,
  },
  shoveMs: 420,
  fade: {
    from: 1,
    to: 0.67,
  },
  distance: {
    enabled: true,
    from: 1,
    to: 22,
    floor: 0.12,
    combine: 'ceiling',
  },
  chips: {
    cards: true,
    zones: true,
    size: 0.03,
    shrink: 0.45,
    inset: 0.006,
    bleed: 0,
  },
}
