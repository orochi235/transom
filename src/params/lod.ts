/** One LOD tier. `edge` of 0 means no texture — a flat quad in the average color. */
export type LodTier = { maxRank: number; edge: 0 | 32 | 128 | 512 }

export type LodParams = {
  /** What each rank costs to draw, and the ceiling on all of it together. The
   *  budget lives here rather than on its own because it is the same decision
   *  read from the other end: the tiers spend, and this is the purse. */
  lod: {
    tiers: LodTier[]
    /** Texture byte budget. A backstop, not the thing shaping the design. */
    budgetBytes: number
    /** Ranks past this are not placed at all — the tier ladder's last rung.
     *  The tiers spend less on a card the deeper it sits, 512 down to an
     *  untextured quad; this is where the wall stops paying for one. */
    rankCap: number
    /** The wall stays dark on load until the front of every pile has its
     *  picture, then fades in assembled. The hold is a ceiling, not a wait:
     *  a card that never decodes must not keep the wall off. Zero shows every
     *  card the moment it is placed. */
    revealHoldMs: number
    revealFadeMs: number
  }
}

export const lodDefaults: LodParams = {
  lod: {
    tiers: [
      {
        maxRank: 1,
        edge: 512,
      },
      {
        maxRank: 8,
        edge: 128,
      },
      {
        maxRank: 40,
        edge: 32,
      },
      {
        maxRank: Number.MAX_SAFE_INTEGER,
        edge: 0,
      },
    ],
    budgetBytes: 268435456,
    rankCap: 88,
    revealHoldMs: 1200,
    revealFadeMs: 250,
  },
}
