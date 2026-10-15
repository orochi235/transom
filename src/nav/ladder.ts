import type { Side } from './ladder/placement.ts'

export { SIDES, type Side, type Placement, type Candidate, type Group } from './ladder/placement.ts'
export { footOf } from './ladder/geometry.ts'
export { scoreLayout, type Weights } from './ladder/score.ts'
export { solve } from './ladder/solve.ts'

/** A card as the ladder sees it: its center and half extents in the pile's plane. */
export type Card = { x: number; y: number; hw: number; hh: number }
export type PlateSize = { w: number; h: number }

/**
 * Every plate of a pile at the same offset from its own card, so the group
 * inherits the pile's own step and reads as its projection. Where that step is
 * shorter than a plate, later plates slide along the pile's axis until they
 * clear the one before, so the order of the ladder is always the order of the
 * pile. Ring 1 touches the pile, at `gap`; each ring past it stands one plate
 * height further out, the same stride on every side.
 */
export function ladder(
  cards: readonly Card[],
  plates: readonly PlateSize[],
  side: Side,
  ring: number,
  gap: number,
): { dx: number; dy: number }[] {
  const flank = side === 'left' || side === 'right'
  const sign = side === 'right' || side === 'above' ? 1 : -1
  const stride = Math.max(0, ...plates.map((p) => p.h)) * (ring - 1)
  const out: { dx: number; dy: number }[] = []
  const first = cards[0]
  const last = cards[cards.length - 1]
  // Which way deeper ranks run along the ladder's axis. A pile with no step
  // on that axis climbs, or runs right, so a spread never buries a plate.
  const along = flank ? (last?.y ?? 0) - (first?.y ?? 0) : (last?.x ?? 0) - (first?.x ?? 0)
  const dir = along === 0 ? 1 : Math.sign(along)
  // The far edge of everything placed so far, measured along `dir`. Against
  // all of it rather than the plate before: a pile whose cards jitter back
  // and forth would otherwise let the third plate land back on the first.
  let far: number | undefined
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]
    const plate = plates[i]
    if (!card || !plate) continue
    let dx = flank ? sign * (card.hw + plate.w / 2 + gap + stride) : 0
    let dy = flank ? 0 : sign * (card.hh + plate.h / 2 + gap + stride)
    const half = flank ? plate.h / 2 : plate.w / 2
    let at = flank ? card.y + dy : card.x + dx
    let along = dir * at
    if (far !== undefined && along - half < far + gap) {
      along = far + gap + half
      at = dir * along
      if (flank) dy = at - card.y
      else dx = at - card.x
    }
    far = Math.max(far ?? -Infinity, along + half)
    out.push({ dx, dy })
  }
  return out
}
