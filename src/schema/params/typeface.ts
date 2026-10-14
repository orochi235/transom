import type { PrefGroup } from '@weasel-js/prefs'
import { named } from '@/schema/kinds.ts'
import { TYPEFACES } from '@/typeface.ts'

export const typeface: PrefGroup = {
  name: 'typeface',
  children: {
    label: {
      kind: 'enum',
      name: 'label',
      description: '',
      default: 'oxanium',
      options: named(TYPEFACES),
    },
    badge: {
      kind: 'enum',
      name: 'badge',
      description: '',
      default: 'oxanium',
      options: named(TYPEFACES),
    },
    chrome: {
      kind: 'enum',
      name: 'chrome',
      description: '',
      default: 'oxanium',
      options: named(TYPEFACES),
    },
  },
}
