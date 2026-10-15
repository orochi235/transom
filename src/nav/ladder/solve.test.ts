import { describe, expect, it } from 'vitest'
import type { Candidate, Group } from './placement.ts'
import { scoreLayout, type Weights } from './score.ts'
import { solve } from './solve.ts'
import type { Box } from '@/nav/whitespace.ts'

const box = (x0: number, y0: number, x1: number, y1: number): Box => ({ x0, y0, x1, y1 })

const weights: Weights = {
  cover: 300,
  pull: 90,
  line: 140,
  foreign: 200,
  mismatch: 80,
  parallel: 0,
  align: 0,
  stack: 0,
  exposed: 0,
  settle: 0.25,
}

/** A plate box of the standard size, with its top-left at (x, y). */
const plate = (x: number, y: number): Box => box(x, y, x + 0.1, y + 0.04)

const candidate = (side: Candidate['side'], boxes: Box[], ring = 1): Candidate => ({ side, ring, boxes })

/** A pile with one plated card at (x, y), offered welded and both flanks. */
const lone = (zone: string, x: number, y: number): Group => ({
  zone,
  cards: [box(x, y, x + 0.2, y + 0.2)],
  candidates: [
    candidate('welded', [plate(x, y - 0.05)]),
    candidate('right', [plate(x + 0.22, y + 0.08)]),
    candidate('left', [plate(x - 0.12, y + 0.08)]),
  ],
})

/** Two plated cards in a pile at (x, y): the group stands on either flank. */
const pair = (zone: string, x: number, y: number): Group => ({
  zone,
  cards: [box(x, y, x + 0.2, y + 0.2), box(x + 0.02, y - 0.02, x + 0.22, y + 0.18)],
  candidates: [
    candidate('right', [plate(x + 0.22, y + 0.1), plate(x + 0.24, y + 0.04)]),
    candidate('left', [plate(x - 0.12, y + 0.1), plate(x - 0.1, y + 0.04)]),
  ],
})

describe('solve', () => {
  it('welds the lone plate of a front card rather than paying for a line', () => {
    const { picks } = solve([], [], [lone('a', 0.4, 0.4)], weights)
    expect(picks[0]?.side).toBe('welded')
  })

  it('stands every pile on the same side of an empty wall', () => {
    const groups = [pair('a', 0.2, 0.4), pair('b', 0.5, 0.4), pair('c', 0.8, 0.4)]
    const { picks } = solve([], [], groups, weights)
    const sides = new Set(picks.map((p) => p.side))
    expect(sides.size).toBe(1)
  })

  it('lets one pile leave the shared side when its own copy of that side is covered', () => {
    // A card to the right of pile b and one to the left of pile a: neither
    // side suits both, so the mismatch is the lesser cost.
    const cards = [box(0.85, 0.3, 1, 0.6), box(0, 0.3, 0.15, 0.6)]
    const groups = [pair('a', 0.15, 0.4), pair('b', 0.65, 0.4)]
    const { picks } = solve(cards, [], groups, weights)
    expect(picks[0]?.side).toBe('right')
    expect(picks[1]?.side).toBe('left')
  })

  it('moves the whole wall over when the shared side is worse for most of it', () => {
    const cards = [box(0.42, 0.3, 0.62, 0.6), box(0.72, 0.3, 0.92, 0.6)]
    const groups = [pair('a', 0.2, 0.4), pair('b', 0.5, 0.4)]
    const { picks } = solve(cards, [], groups, weights)
    expect(picks.every((p) => p.side === 'left')).toBe(true)
  })

  it('holds a settled layout against an improvement smaller than the settle margin', () => {
    const held = { side: 'right', ring: 1 } as const
    const groups = [{ ...pair('a', 0.4, 0.4), held }]
    // A card's corner just under the right flank: not worth leaving for.
    const corner = [box(0.62, 0.4, 0.64, 0.5)]
    expect(solve(corner, [], groups, weights).picks[0]?.side).toBe('right')
    // A card under the whole flank is.
    const card = [box(0.62, 0.4, 0.75, 0.5)]
    expect(solve(card, [], groups, weights).picks[0]?.side).toBe('left')
  })

  it('places a new pile against the held layout without moving the others', () => {
    // A sliver of card under every left flank, so the free answer is right —
    // except that a is held left, and one mismatch costs more than a sliver.
    const slivers = [box(0.39, 0.3, 0.4, 0.6), box(0.69, 0.3, 0.7, 0.6)]
    const groups = [{ ...pair('a', 0.5, 0.4), held: { side: 'left', ring: 1 } as const }, pair('b', 0.8, 0.4)]
    const { picks } = solve(slivers, [], groups, weights)
    expect(picks[0]?.side).toBe('left')
    expect(picks[1]?.side).toBe('left')
  })

  it('takes another zone’s empty cell over its own covered ground, but not over free space', () => {
    const cells = [{ zone: 'b', box: box(0.62, 0.2, 0.95, 0.7) }]
    const group = pair('a', 0.4, 0.4)
    // Right stands in b's cell; left is free. Left wins.
    expect(solve([], cells, [group], weights).picks[0]?.side).toBe('left')
    // Cover the left flank with a card, and b's empty cell becomes the lesser evil.
    expect(solve([box(0.25, 0.3, 0.4, 0.6)], cells, [group], weights).picks[0]?.side).toBe('right')
  })

  it('charges two groups for covering each other far more than for a line', () => {
    const a: Group = { zone: 'a', cards: [box(0.4, 0.4, 0.6, 0.6)], candidates: [candidate('right', [plate(0.62, 0.5)])] }
    const b: Group = { zone: 'b', cards: [box(0.7, 0.4, 0.9, 0.6)], candidates: [candidate('left', [plate(0.62, 0.5)])] }
    const apart = scoreLayout([], [], [a], [0], weights)
    const together = scoreLayout([], [], [a, b], [0, 0], weights)
    expect(together - apart).toBeGreaterThan(weights.line * 5)
  })

  it('charges a plate nothing for touching the card it belongs to', () => {
    const group = pair('a', 0.4, 0.4)
    const touching = scoreLayout(group.cards, [], [group], [0], weights)
    const clear = scoreLayout([], [], [group], [0], weights)
    expect(touching).toBe(clear)
  })

  it('charges a plate over the edge of the screen more than one over a picture', () => {
    const out: Group = { zone: 'a', cards: [box(0.8, 0.4, 1, 0.6)], candidates: [candidate('right', [plate(0.95, 0.5)])] }
    const over: Group = { zone: 'a', cards: [box(0.4, 0.4, 0.6, 0.6)], candidates: [candidate('above', [plate(0.45, 0.42)])] }
    expect(scoreLayout([], [], [out], [0], weights)).toBeGreaterThan(
      scoreLayout([box(0.4, 0.4, 0.6, 0.6)], [], [over], [0], weights),
    )
  })

  it('has nothing to say about an empty wall', () => {
    expect(solve([], [], [], weights).picks).toEqual([])
  })
})

describe('parallel lines', () => {
  // Two cards stacked, plates on the right flank. `level` puts each plate level
  // with its card, so both lines run flat; `skew` lifts the second plate above
  // its card's top corner, so its line leans while the first still runs flat.
  // Neither covers anything and both stand the same distance from their cards.
  const cards = [box(0.4, 0.4, 0.6, 0.6), box(0.4, 0.7, 0.6, 0.9)]
  const skew = candidate('right', [plate(0.62, 0.48), plate(0.6, 0.64)], 1)
  const level = candidate('right', [plate(0.62, 0.48), plate(0.62, 0.78)], 2)
  const pile: Group = { zone: 'a', cards, candidates: [skew, level] }

  it('is indifferent to a leaning line when the weight is zero', () => {
    expect(solve([], [], [pile], weights).picks[0]?.ring).toBe(1)
  })

  it('favors a pile whose lines run parallel to each other', () => {
    expect(solve([], [], [pile], { ...weights, parallel: 100 }).picks[0]?.ring).toBe(2)
  })

  it('favors piles whose lines run the way the rest of the wall’s do', () => {
    // Pile a's only option runs flat. Pile b can stand above, running upright
    // and a hair closer, or right, running flat and a hair further out.
    // Mismatch off, so the lean is the only thing that can beat the distance.
    const flat: Group = {
      zone: 'a',
      cards: [box(0.1, 0.4, 0.3, 0.6)],
      candidates: [candidate('right', [plate(0.32, 0.48)])],
    }
    const b: Group = {
      zone: 'b',
      cards: [box(0.6, 0.4, 0.8, 0.6)],
      candidates: [candidate('above', [plate(0.65, 0.34)]), candidate('right', [plate(0.83, 0.48)])],
    }
    const free = { ...weights, mismatch: 0 }
    expect(solve([], [], [flat, b], free).picks[1]?.side).toBe('above')
    expect(solve([], [], [flat, b], { ...free, align: 100 }).picks[1]?.side).toBe('right')
  })
})

describe('usable screen', () => {
  const card = box(0.6, 0.4, 0.8, 0.6)
  const pile: Group = {
    zone: 'a',
    cards: [card],
    candidates: [candidate('right', [plate(0.82, 0.48)]), candidate('left', [plate(0.48, 0.48)])],
  }
  it('stands on the whole screen when nothing covers it', () => {
    expect(solve([], [], [pile], weights).picks[0]?.side).toBe('right')
  })
  it('treats the part under the chrome as off screen', () => {
    const under = box(0, 0, 0.8, 1)
    expect(solve([], [], [pile], weights, under).picks[0]?.side).toBe('left')
  })
})

describe('stacking ladders', () => {
  // Pile a's ladder stands to the right of its card. Pile b, below it, can
  // stand right — directly under a's ladder — or left, apart from it. Both
  // stand the same distance from their cards and cover nothing.
  const a: Group = {
    zone: 'a',
    cards: [box(0.5, 0.3, 0.7, 0.5)],
    candidates: [candidate('right', [plate(0.72, 0.38)])],
  }
  const b: Group = {
    zone: 'b',
    cards: [box(0.5, 0.5, 0.7, 0.7)],
    candidates: [candidate('left', [plate(0.38, 0.58)]), candidate('right', [plate(0.72, 0.58)])],
  }
  const free = { ...weights, mismatch: 0 }
  it('is indifferent when the weight is zero', () => {
    expect(solve([], [], [a, b], free).picks[1]?.side).toBe('left')
  })
  it('favors a ladder that lines up under another', () => {
    expect(solve([], [], [a, b], { ...free, stack: 100 }).picks[1]?.side).toBe('right')
  })
})

describe('exposed edges', () => {
  // A pile stepping up and left: the deeper card shows its left edge and
  // buries its right one under the front card. Either flank stands the same
  // distance from each card.
  const cards = [box(0.5, 0.5, 0.7, 0.7), box(0.48, 0.48, 0.68, 0.68)]
  const pile: Group = {
    zone: 'a',
    cards,
    candidates: [
      candidate('right', [plate(0.72, 0.58), plate(0.7, 0.64)]),
      candidate('left', [plate(0.38, 0.58), plate(0.36, 0.64)]),
    ],
  }
  it('is indifferent when the weight is zero', () => {
    expect(solve([], [], [pile], weights).picks[0]?.side).toBe('right')
  })
  it('favors the side where every card shows an edge', () => {
    expect(solve([], [], [pile], { ...weights, exposed: 100 }).picks[0]?.side).toBe('left')
  })
})
