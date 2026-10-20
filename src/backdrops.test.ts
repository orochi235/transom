import { describe, expect, it } from 'vitest'
import { BACKDROPS } from '@shared/backdrops.ts'
import { PATTERN_INDEX, PATTERNS, reads } from '@/backdrops.ts'

describe('PATTERNS', () => {
  it('describes every backdrop', () => {
    // The point of the table: adding a pattern to BACKDROPS without saying what
    // it reads used to leave it silently offering controls it ignores.
    for (const backdrop of BACKDROPS) expect(PATTERNS[backdrop]).toBeDefined()
  })

  it('gives every drawn pattern a repeat with size in both directions', () => {
    for (const backdrop of BACKDROPS) {
      const tile = PATTERNS[backdrop].tile(0.2, 0.4)
      expect(tile.u, backdrop).toBeGreaterThan(0)
      expect(tile.v, backdrop).toBeGreaterThan(0)
    }
  })

  it('reads a second pitch only where the shader has one', () => {
    // `uPeriod` is read by the patterns set on independent axes and by
    // nothing else, so a `repeat` row anywhere else would move nothing.
    const withPeriod = BACKDROPS.filter((b) => reads(b, 'period'))
    expect([...withPeriod].sort()).toEqual(['braid', 'chevron', 'waves'])
  })

  it('offers nothing for the patterns that are not ruled', () => {
    expect(PATTERNS.none.reads).toHaveLength(0)
    expect(PATTERNS.solid.reads).toHaveLength(0)
  })

  it('scales a repeat with the pitch it is given', () => {
    const near = PATTERNS.bricks.tile(0.1, 0.4)
    const far = PATTERNS.bricks.tile(0.2, 0.4)
    expect(far.u).toBeCloseTo(near.u * 2, 10)
  })

  it('keeps a shader case for everything it describes', () => {
    for (const backdrop of BACKDROPS) expect(PATTERN_INDEX[backdrop]).toBeDefined()
  })
})
