import { describe, expect, it } from 'vitest'
import { ladder } from './ladder.ts'

describe('ladder', () => {
  const plates = [
    { w: 0.3, h: 0.1 },
    { w: 0.3, h: 0.1 },
    { w: 0.3, h: 0.1 },
  ]

  it('puts every plate level with its own card on a flank, so the group steps as the pile does', () => {
    const cards = [
      { x: 0, y: 0, hw: 0.5, hh: 0.5 },
      { x: 0.1, y: 0.2, hw: 0.5, hh: 0.5 },
      { x: 0.2, y: 0.4, hw: 0.5, hh: 0.5 },
    ]
    const out = ladder(cards, plates, 'right', 1, 0.02)
    expect(out.every((o) => o.dy === 0)).toBe(true)
    expect(out.every((o) => o.dx === 0.5 + 0.15 + 0.02)).toBe(true)
  })

  it('spreads plates along the pile when its step is shorter than a plate, keeping the order', () => {
    const cards = [
      { x: 0, y: 0, hw: 0.5, hh: 0.5 },
      { x: 0.02, y: 0.03, hw: 0.5, hh: 0.5 },
      { x: 0.04, y: 0.06, hw: 0.5, hh: 0.5 },
    ]
    const out = ladder(cards, plates, 'left', 1, 0.02)
    const ys = out.map((o, i) => (cards[i]?.y ?? 0) + o.dy)
    expect(ys[0]).toBe(0)
    expect(ys[1]).toBeCloseTo(0.12)
    expect(ys[2]).toBeCloseTo(0.24)
    expect(out.every((o) => o.dx < 0)).toBe(true)
  })

  it('runs the spread the way the pile leans, and climbs when it does not lean at all', () => {
    const leaning = ladder(
      [
        { x: 0, y: 0, hw: 0.5, hh: 0.5 },
        { x: 0, y: -0.01, hw: 0.5, hh: 0.5 },
      ],
      plates,
      'right',
      1,
      0,
    )
    expect((leaning[1]?.dy ?? 0) + -0.01).toBeLessThan(0)
    const flat = ladder(
      [
        { x: 0, y: 0, hw: 0.5, hh: 0.5 },
        { x: 0, y: 0, hw: 0.5, hh: 0.5 },
      ],
      plates,
      'right',
      1,
      0,
    )
    expect(flat[1]?.dy).toBeGreaterThan(0)
  })

  it('lays a group above the pile sideways, each plate over its own card', () => {
    const cards = [
      { x: 0, y: 0, hw: 0.5, hh: 0.5 },
      { x: 0.5, y: 0.1, hw: 0.5, hh: 0.5 },
    ]
    const out = ladder(cards, plates, 'above', 1, 0.02)
    expect(out.every((o) => o.dx === 0)).toBe(true)
    expect(out.every((o) => o.dy === 0.5 + 0.05 + 0.02)).toBe(true)
  })

  it('steps one plate height further out per ring, rather than a whole plate width of nothing', () => {
    const cards = [{ x: 0, y: 0, hw: 0.5, hh: 0.5 }]
    const near = ladder(cards, plates, 'right', 1, 0.02)[0]!
    const far = ladder(cards, plates, 'right', 3, 0.02)[0]!
    expect(far.dx - near.dx).toBeCloseTo(0.2)
  })
})

describe('ladder spacing', () => {
  it('spaces each plate against everything placed so far, not only the plate before', () => {
    // Cards that jitter back and forth in y: the third sits between the first
    // two, and spacing against the second alone would land it on the first.
    const cards = [
      { x: 0, y: 0, hw: 0.5, hh: 0.5 },
      { x: 0.01, y: 0.03, hw: 0.5, hh: 0.5 },
      { x: 0.02, y: -0.02, hw: 0.5, hh: 0.5 },
    ]
    const plates = [
      { w: 0.3, h: 0.1 },
      { w: 0.3, h: 0.1 },
      { w: 0.3, h: 0.1 },
    ]
    const out = ladder(cards, plates, 'left', 1, 0.02)
    const ys = out.map((o, i) => (cards[i]?.y ?? 0) + o.dy)
    expect(ys[0]).toBe(0)
    expect(ys[1]).toBeCloseTo(-0.12)
    expect(ys[2]).toBeCloseTo(-0.24)
  })
})
