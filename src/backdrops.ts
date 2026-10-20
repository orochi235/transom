import type { Backdrop } from '@shared/backdrops.ts'

/** The shader's case for each pattern. `none` is not drawn at all. */
export const PATTERN_INDEX: Record<Backdrop, number> = {
  none: -1,
  solid: 0,
  hatch: 1,
  crosshatch: 2,
  grid: 3,
  bricks: 4,
  dots: 5,
  checks: 6,
  argyle: 7,
  chevron: 8,
  waves: 9,
  scales: 10,
  hexagons: 11,
  triangles: 12,
  basketweave: 13,
  parquet: 14,
  dragonscale: 15,
  rosette: 16,
  braid: 17,
}

/** A control the ruling offers, and a uniform the shader reads. */
export type Rule = 'spacing' | 'period' | 'width' | 'angle'

/**
 * What one pattern answers to, and how far it goes before it repeats.
 *
 * `reads` is which of the ruling's controls reach this pattern. Every pattern
 * used to be offered density and rotation whatever it did with them, and a
 * second pitch only if it was one of two named in a set — so `checks` offered
 * a line width it never draws, and adding a pattern meant remembering to edit
 * that set somewhere else.
 *
 * `tile` is the pattern's repeat in world units, along the ruling and across
 * it, given the two pitches. A swatch is repeated as a tile, so it has to be
 * framed on exactly this or it will not meet its own edge — and several of
 * these are irrational against the spacing (`grid` at root two, `hexagons` at
 * root three), which is why the frame is computed rather than assumed square.
 */
export type PatternSpec = {
  reads: readonly Rule[]
  tile: (spacing: number, period: number) => { u: number; v: number }
}

const R2 = Math.SQRT2
const R3 = 1.73205081

/** Ruled one way: a pitch across the rules, a width, and an angle. */
const RULED: readonly Rule[] = ['spacing', 'width', 'angle']
/** Ruled on two axes set apart, so the second pitch is the pattern's shape. */
const TWO_PITCH: readonly Rule[] = ['spacing', 'period', 'width', 'angle']

export const PATTERNS: Record<Backdrop, PatternSpec> = {
  // Draws nothing and fills flat: neither reads a pitch or an angle.
  none: { reads: [], tile: () => ({ u: 1, v: 1 }) },
  solid: { reads: [], tile: () => ({ u: 1, v: 1 }) },

  hatch: { reads: RULED, tile: (s) => ({ u: s, v: s }) },
  crosshatch: { reads: RULED, tile: (s) => ({ u: s, v: s }) },
  // Turned a further forty-five degrees, so its lattice steps by the diagonal.
  grid: { reads: RULED, tile: (s) => ({ u: s * R2, v: s * R2 }) },
  // Two courses, because alternate ones are shifted half a brick.
  bricks: { reads: RULED, tile: (s) => ({ u: 2 * s, v: 2 * s }) },
  dots: { reads: RULED, tile: (s) => ({ u: s, v: s }) },
  // Two cells each way: the alternation is the pattern, not the cell.
  checks: { reads: ['spacing', 'angle'], tile: (s) => ({ u: 2 * s, v: 2 * s }) },
  // Diamonds on the turned lattice, taller than they are wide by 1.7.
  argyle: { reads: RULED, tile: (s) => ({ u: 2 * R2 * s, v: 2 * R2 * 1.7 * s }) },
  // The crease runs on its own period, which is the whole reason it has one.
  chevron: { reads: TWO_PITCH, tile: (s, p) => ({ u: p, v: s }) },
  waves: { reads: TWO_PITCH, tile: (s, p) => ({ u: p, v: s }) },
  // Alternate courses notch into the one above, so two make the repeat.
  scales: { reads: RULED, tile: (s) => ({ u: s, v: 2 * s }) },
  hexagons: { reads: RULED, tile: (s) => ({ u: s, v: s * R3 }) },
  // Three rulings sixty degrees apart: the across-repeat is the short leg.
  triangles: { reads: RULED, tile: (s) => ({ u: s / (R3 / 2), v: 2 * s }) },
  basketweave: { reads: RULED, tile: (s) => ({ u: 2 * s, v: 2 * s }) },
  parquet: { reads: RULED, tile: (s) => ({ u: 3 * s, v: 3 * s }) },
  // Courses are six tenths of a spacing, and alternate ones are shifted.
  dragonscale: { reads: RULED, tile: (s) => ({ u: s, v: 1.2 * s }) },
  // A medallion per cell, sixteen rings across: a repeat of its own would sit
  // at the default two rings, which is no rosette at all.
  rosette: { reads: RULED, tile: (s) => ({ u: 16 * s, v: 16 * s }) },
  braid: { reads: TWO_PITCH, tile: (s, p) => ({ u: p, v: s }) },
}

/** Whether a pattern answers to one of the ruling's controls. */
export const reads = (backdrop: Backdrop, rule: Rule): boolean =>
  PATTERNS[backdrop].reads.includes(rule)
