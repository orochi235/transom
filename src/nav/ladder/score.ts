import type { Box } from '@/nav/whitespace.ts'
import type { Group, Side } from './placement.ts'
import { center, covered, coveredOf, gapBetween, heightOf, leanOf, meanLean, spread, unionOf } from './geometry.ts'

export type Weights = {
  /** Per plate wholly over a card; a partial cover pays its share, and cards
   *  stacked under it each charge, so a pile reads as busier than one card. */
  cover: number
  /** Per screen unit of leader line, summed over the group. */
  pull: number
  /** Flat, per plate that needs a line at all. */
  line: number
  /** Per plate wholly over another zone's cell; a partial cover pays its share. */
  foreign: number
  /** Per group standing on a side the others do not. */
  mismatch: number
  /** Per plate, for how far its line leans away from the lines of the other
   *  plates in its pile: 0 parallel, 2 perpendicular. */
  parallel: number
  /** Per pile, for how far its lines lean away from the wall's. Same scale. */
  align: number
  /** Per pile, for standing apart from every other ladder rather than directly
   *  above or below one: 0 touching, 1 at eight plate heights or with no ladder
   *  sharing any of its horizontal span. Same x is never asked for. */
  stack: number
  /** Per pile, for standing on a side where the deeper cards' edges are hidden
   *  under the front card. Which sides show is read off the pile's step. */
  exposed: number
  /** The share of its score a new layout must beat the held one by before the
   *  wall leaves it. A share rather than a sum so that zooming, which scales
   *  every score together, is never by itself a reason to move. */
  settle: number
}

/** Two plates covering each other leaves neither readable: fixed, and above
 *  anything a knob can reach. Scaled by how much of the smaller plate is covered. */
const OVERLAP = 1200

/** Per plate wholly off the screen; a partial pays its share. As heavy as
 *  two plates on top of each other: nobody can read either. */
const OFFSCREEN = 1200

export const SCREEN: Box = { x0: 0, y0: 0, x1: 1, y1: 1 }

/** How many plate heights of stacking count as "apart". */
const STACK_REACH = 8

/**
 * How far a ladder is from reading as one list with another: the vertical gap
 * to the nearest other ladder sharing some of its horizontal span, in plate
 * heights over `STACK_REACH`, capped at 1. No such neighbor is 1.
 */
const stackCost = (a: { box: Box; h: number }, all: readonly { box: Box; h: number }[]): number => {
  let nearest = Infinity
  for (const b of all) {
    if (b === a) continue
    if (b.box.x1 <= a.box.x0 || b.box.x0 >= a.box.x1) continue
    const gap = Math.max(0, Math.max(a.box.y0, b.box.y0) - Math.min(a.box.y1, b.box.y1))
    if (gap < nearest) nearest = gap
  }
  if (!Number.isFinite(nearest) || a.h <= 0) return 1
  return Math.min(1, nearest / (a.h * STACK_REACH))
}

/**
 * 1 when the side hides the deeper cards' edges under the front one, else 0.
 * The pile's step in screen space says which: cards stepping left show their
 * left edges and bury their right ones. A step under a twentieth of a card is
 * no step, and neither flank pays.
 */
const exposedCost = (cards: readonly Box[], side: Side | 'welded'): number => {
  const first = cards[0]
  const last = cards[cards.length - 1]
  if (!first || !last || cards.length < 2 || side === 'welded') return 0
  const [fx, fy] = center(first)
  const [lx, ly] = center(last)
  const dead = Math.max(first.x1 - first.x0, first.y1 - first.y0) / 20
  const dx = lx - fx
  const dy = ly - fy
  if (side === 'left') return dx > dead ? 1 : 0
  if (side === 'right') return dx < -dead ? 1 : 0
  // Screen y grows downward: a pile stepping up has dy < 0 and shows its tops.
  if (side === 'above') return dy > dead ? 1 : 0
  return dy < -dead ? 1 : 0
}

/**
 * One number for the whole wall. Every plate pays for the cards it covers, for
 * hanging off screen, for its line and for standing on another zone's ground;
 * groups pay for covering each other, for disagreeing about which side of
 * their pile to stand on, for standing on a side that hides the cards' edges,
 * and for not lining up under one another.
 */
export function scoreLayout(
  obstacles: readonly Box[],
  cells: readonly { zone: string; box: Box }[],
  groups: readonly Group[],
  picks: readonly number[],
  weights: Weights,
  /** The part of the screen a plate may stand on: the whole of it, less
   *  whatever chrome covers it. */
  usable: Box = SCREEN,
): number {
  let total = 0
  const votes = new Map<Side, number>()
  let voting = 0
  const placed: Box[][] = []
  const pileLeans: [number, number][] = []
  const ladders: { box: Box; h: number }[] = []
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g]
    const candidate = group?.candidates[picks[g] ?? -1]
    if (!group || !candidate) {
      placed.push([])
      continue
    }
    placed.push([...candidate.boxes])
    if (candidate.side !== 'welded') {
      voting++
      votes.set(candidate.side, (votes.get(candidate.side) ?? 0) + 1)
    }
    const leans: [number, number][] = []
    for (let i = 0; i < candidate.boxes.length; i++) {
      const box = candidate.boxes[i]
      const card = group.cards[i]
      if (!box) continue
      if (candidate.side !== 'welded' && card) {
        const lean = leanOf(box, card)
        if (lean) leans.push(lean)
      }
      total += (1 - coveredOf(box, usable)) * OFFSCREEN
      for (const under of obstacles) total += coveredOf(box, under) * weights.cover
      if (candidate.side !== 'welded') {
        total += weights.line
        if (card) total += gapBetween(box, card) * weights.pull
      }
      for (const cell of cells) {
        if (cell.zone === group.zone) continue
        total += coveredOf(box, cell.box) * weights.foreign
      }
    }
    const mean = meanLean(leans)
    if (mean) {
      for (const lean of leans) total += spread(lean, mean) * weights.parallel
      pileLeans.push(mean)
    }
    if (candidate.side !== 'welded' && candidate.boxes.length > 0) {
      ladders.push({ box: unionOf(candidate.boxes), h: heightOf(candidate.boxes) })
      total += exposedCost(group.cards, candidate.side) * weights.exposed
    }
  }
  const wallLean = meanLean(pileLeans)
  if (wallLean) for (const lean of pileLeans) total += spread(lean, wallLean) * weights.align
  if (weights.stack > 0 && ladders.length > 1) {
    for (const a of ladders) total += stackCost(a, ladders) * weights.stack
  }
  for (let a = 0; a < placed.length; a++) {
    for (let b = a + 1; b < placed.length; b++) {
      for (const pa of placed[a] ?? []) for (const pb of placed[b] ?? []) total += covered(pa, pb) * OVERLAP
    }
  }
  let agreed = 0
  for (const n of votes.values()) agreed = Math.max(agreed, n)
  total += (voting - agreed) * weights.mismatch
  return total
}
