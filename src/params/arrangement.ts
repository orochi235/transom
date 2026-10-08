export const INBOX_MODES = ['grid', 'mosaic', 'river'] as const
export type InboxMode = (typeof INBOX_MODES)[number]

export type ArrangementParams = {
  zoneGrid: {
    gap: number
    /** How the column count is chosen when neither `cols` nor `rows` is set.
     *  `wide` and `tall` square the zone count; `fit` squares the cells for
     *  the container, which is what a wall that changes shape wants. */
    orientation: 'wide' | 'tall' | 'fit'
    cols?: number
    rows?: number
    /**
     * The width one cell holds, in container units, instead of dividing the
     * viewport between the zones. Set, a zone keeps its size as zones arrive
     * and the wall gets longer rather than finer — which needs
     * `camera.fitWidth` off, or the camera shrinks it all back to fit.
     */
    cellW?: number
    /**
     * The fewest cells the grid lays out, however few zones there are. A wall
     * with one repo writing to it otherwise hands that pile the whole
     * container, so the general view is a different size every time a zone
     * arrives or falls quiet. The spare cells draw nothing — they are room,
     * not zones — and the wall frames them so zooming out settles on one
     * framing rather than on however many piles happen to exist.
     */
    minCells: number
    /** Which way the zones run along each axis. Mirroring the placed cells
     *  rather than re-sorting the slots, so reversing an axis moves the grid
     *  and never renumbers a zone — a pile keeps the cell it has claimed. */
    reverseX: boolean
    reverseY: boolean
    /** How long a pile takes to reach a new cell, when a sort, a pin or an
     *  arriving zone reshuffles the grid. */
    moveMs: number
  }
  /** The `inbox` arrangement: every artifact at once, zones ignored, newest
   *  first. Age still fades a card through `fade`. */
  inbox: {
    /** `grid` is equal cells in reading order; `mosaic` gives the newest the
     *  biggest cells; `river` sets each card's distance from the left edge by
     *  its age, in lanes. */
    mode: InboxMode
    /** World space between two cards. */
    gap: number
    /** The largest a card may be, so three artifacts do not fill the wall. */
    maxSide: number
    /** The smallest a card may shrink to. Past it, the oldest leave the wall
     *  and the band counts them instead. */
    floor: number
    /** How long a card takes to reach a new place when an arrival moves it. */
    moveMs: number
    /** Mosaic: how many of the newest take three cells square, then two. */
    big: number
    mid: number
    /** River: rows the cards travel in. */
    lanes: number
  }
}

export const arrangementDefaults: ArrangementParams = {
  zoneGrid: {
    gap: 0.425,
    orientation: 'fit',
    reverseX: false,
    reverseY: false,
    minCells: 4,
    moveMs: 520,
  },
  inbox: {
    mode: 'grid',
    gap: 0.02,
    maxSide: 0.45,
    floor: 0.07,
    moveMs: 520,
    big: 1,
    mid: 4,
    lanes: 10,
  },
}
