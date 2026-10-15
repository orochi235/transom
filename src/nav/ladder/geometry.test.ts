import { describe, expect, it } from 'vitest'
import { footOf } from './geometry.ts'
import type { Box } from '@/nav/whitespace.ts'

const box = (x0: number, y0: number, x1: number, y1: number): Box => ({ x0, y0, x1, y1 })

/** A plate box of the standard size, with its top-left at (x, y). */
const plate = (x: number, y: number): Box => box(x, y, x + 0.1, y + 0.04)

describe('footOf', () => {
  const card = box(0.4, 0.4, 0.6, 0.6)
  it('leaves from the center of the edge facing the card', () => {
    expect(footOf(plate(0.62, 0.48), card)).toEqual([0.62, 0.5])
    expect(footOf(plate(0.28, 0.48), card)).toEqual([0.38, 0.5])
    expect(footOf(plate(0.45, 0.34), card)).toEqual([0.5, 0.38])
    expect(footOf(plate(0.45, 0.62), card)).toEqual([0.5, 0.62])
  })
  it('picks the edge by which axis the card lies further beyond', () => {
    // Above and to the right, but further above: the bottom edge.
    expect(footOf(plate(0.62, 0.3), card)[1]).toBeCloseTo(0.34)
  })
})
