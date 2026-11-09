import type { PrefGroup } from '@weasel-js/prefs'
import { FOLLOW_MODES } from '@/params/follow.ts'
import { named } from '@/schema/kinds.ts'

export const follow: PrefGroup = {
  name: 'follow',
  children: {
    arrivals: {
      kind: 'enum',
      name: 'arrivals',
      description: '',
      default: 'off',
      options: named(FOLLOW_MODES),
    },
  },
}
