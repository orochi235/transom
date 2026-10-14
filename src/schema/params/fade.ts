import type { PrefGroup } from '@weasel-js/prefs'

export const fade: PrefGroup = {
  name: 'fade',
  children: {
    from: {
      kind: 'number',
      name: 'from',
      description: '',
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
      control: 'slider',
    },
    to: {
      kind: 'number',
      name: 'to',
      description: '',
      default: 0.67,
      min: 0,
      max: 1,
      step: 0.01,
      control: 'slider',
    },
  },
}
