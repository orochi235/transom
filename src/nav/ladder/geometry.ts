import type { Box } from '@/nav/whitespace.ts'

const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0)

/** The share of the smaller box the two have in common. */
export const covered = (a: Box, b: Box): number => {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  if (w <= 0 || h <= 0) return 0
  const smaller = Math.min(area(a), area(b))
  return smaller > 0 ? (w * h) / smaller : 0
}

/** The share of `plate` that `under` covers. */
export const coveredOf = (plate: Box, under: Box): number => {
  const w = Math.min(plate.x1, under.x1) - Math.max(plate.x0, under.x0)
  const h = Math.min(plate.y1, under.y1) - Math.max(plate.y0, under.y0)
  if (w <= 0 || h <= 0) return 0
  const own = area(plate)
  return own > 0 ? (w * h) / own : 0
}

/** Shortest distance between two boxes, zero when they touch or overlap. */
export const gapBetween = (a: Box, b: Box): number =>
  Math.hypot(
    Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1)),
    Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1)),
  )

const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const center = (b: Box): [number, number] => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]

/**
 * Where a plate's line leaves it: the center of the edge that faces the card,
 * chosen by which axis the card lies further beyond. The renderer draws its
 * foot the same way.
 */
export const footOf = (plate: Box, card: Box): [number, number] => {
  const [px, py] = center(plate)
  const [cx, cy] = center(card)
  const overX = Math.abs(cx - px) - (plate.x1 - plate.x0) / 2
  const overY = Math.abs(cy - py) - (plate.y1 - plate.y0) / 2
  if (overX > overY) return [cx > px ? plate.x1 : plate.x0, py]
  return [px, cy > py ? plate.y1 : plate.y0]
}

/**
 * The lean of a plate's line as a unit vector at twice its angle, so a line
 * and its reverse — a plate on the left, a plate on the right — count as
 * parallel. The line runs the way the renderer draws it: from the edge of the
 * plate facing the card to the point of the card's border nearest the plate.
 * Null when the two touch, which is no line at all.
 */
export const leanOf = (plate: Box, card: Box): [number, number] | null => {
  const [fx, fy] = footOf(plate, card)
  const dx = clampTo(fx, card.x0, card.x1) - fx
  const dy = clampTo(fy, card.y0, card.y1) - fy
  if (Math.hypot(dx, dy) < 1e-6) return null
  const a = 2 * Math.atan2(dy, dx)
  return [Math.cos(a), Math.sin(a)]
}

/** The mean direction of a set of leans, unit length; null for none. */
export const meanLean = (leans: readonly [number, number][]): [number, number] | null => {
  if (leans.length === 0) return null
  let x = 0
  let y = 0
  for (const [lx, ly] of leans) {
    x += lx
    y += ly
  }
  const n = Math.hypot(x, y)
  return n < 1e-9 ? [0, 0] : [x / n, y / n]
}

/** 0 for parallel, 2 for perpendicular. */
export const spread = (lean: [number, number], mean: [number, number]) => 1 - (lean[0] * mean[0] + lean[1] * mean[1])

export const unionOf = (boxes: readonly Box[]): Box => ({
  x0: Math.min(...boxes.map((b) => b.x0)),
  y0: Math.min(...boxes.map((b) => b.y0)),
  x1: Math.max(...boxes.map((b) => b.x1)),
  y1: Math.max(...boxes.map((b) => b.y1)),
})

export const heightOf = (boxes: readonly Box[]): number =>
  boxes.reduce((sum, b) => sum + (b.y1 - b.y0), 0) / boxes.length
