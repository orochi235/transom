import type { PrefAlias } from '@weasel-js/prefs'

/** A pointer to the param at `of`, which names it and describes it. */
export const to = (of: string): PrefAlias => ({
  kind: 'alias',
  name: '',
  description: '',
  default: undefined,
  of,
})
