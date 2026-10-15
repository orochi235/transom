import type { Box } from '@/nav/whitespace.ts'

/**
 * Where a pile's plates may stand as a group. `welded` is the one plate of a
 * pile whose only flag is on the front card, resting on that card with no line.
 */
export type Side = 'left' | 'right' | 'above' | 'below'
export const SIDES: readonly Side[] = ['right', 'left', 'above', 'below']

export type Placement = { side: Side | 'welded'; ring: number }

export type Candidate = Placement & { boxes: readonly Box[] }

/** One pile's plates, and every place the group could stand, in screen space. */
export type Group = {
  zone: string
  /** The plated cards, in pile order, matching each candidate's boxes. */
  cards: readonly Box[]
  candidates: readonly Candidate[]
  /** Where the group stands now, if it has been placed before. */
  held?: Placement
}
