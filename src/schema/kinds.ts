import type { PrefBase, PrefLeaf } from '@weasel-js/prefs'

/** One of a few numbers. The kit's `enum` holds strings, and a tier's edge is
 *  read as a number wherever it is used. */
export interface PrefChoice extends PrefBase<'choice', number> {
  options: readonly number[]
}

export const choice = (leaf: Omit<PrefChoice, 'kind'>): PrefLeaf => ({ kind: 'choice', ...leaf })

/** The zone backdrop: a pattern picked from swatches, with the ruling it is
 *  drawn at beside it. Holds the pattern's name; the ruling is the three
 *  hidden `zones.hatch*` leaves. */
export const BACKDROP = 'backdrop'

/** An enum's options from a list kept elsewhere, each named by its own value. */
export const named = (values: readonly string[]) => values.map((value) => ({ value, label: value }))
