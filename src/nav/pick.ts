import type { Rect } from 'windease'

/**
 * The zone whose cell contains a point, in rect space — y grows downward.
 *
 * Hit-testing the cells beats an invisible plane per cell in the scene: a plane
 * has to sit behind the deepest card the rank cap allows or it steals the card
 * picks, which puts it several world units back and parallax-shifted the moment
 * the camera turns. This answers for a pile with no cards in it too.
 *
 * The top-left edge belongs to the cell and the bottom-right does not, so two
 * cells sharing an edge never both claim a point on it. Where cells overlap —
 * a pile's deep ranks step past its own box — the tighter cell wins, so a
 * sprawling neighbour cannot swallow a small one.
 */
export function zoneAt(
  point: { x: number; y: number },
  cells: ReadonlyMap<string, Rect>,
): string | null {
  let best: { zone: string; area: number } | null = null
  for (const [zone, r] of cells) {
    if (point.x < r.x || point.x >= r.x + r.w) continue
    if (point.y < r.y || point.y >= r.y + r.h) continue
    const area = r.w * r.h
    if (!best || area < best.area) best = { zone, area }
  }
  return best ? best.zone : null
}

/**
 * Which of the ray's hits, nearest first, the pointer means. Over a zone's base
 * only that zone's cards count: perspective swings a pile's deep ranks across
 * its neighbours, and nearest-first would hand them a neighbour's clicks.
 */
export function cardHit<T>(
  hits: readonly T[],
  zoneOf: (hit: T) => string | undefined,
  owner: string | null,
): T | undefined {
  return owner === null ? hits[0] : hits.find((hit) => zoneOf(hit) === owner)
}
