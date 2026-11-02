import type { PrefGroup } from '@weasel-js/prefs'
import { MATTE_WHERE } from '@/params/matte.ts'
import { named } from '@/schema/kinds.ts'

export const matte: PrefGroup = {
  name: 'matte',
  children: {
    where: {
      kind: 'enum',
      name: 'where',
      description: '',
      default: 'both',
      options: named(MATTE_WHERE),
    },
    opacity: {
      kind: 'number',
      name: 'opacity',
      description: '',
      default: 0.7,
      min: 0,
      max: 1,
      step: 0.01,
      control: 'slider',
    },
  },
}
