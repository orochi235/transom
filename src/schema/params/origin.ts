import type { PrefGroup } from '@weasel-js/prefs'

export const origin: PrefGroup = {
  name: 'origin',
  children: {
    x: {
      kind: 'number',
      name: 'x',
      description: '',
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      control: 'slider',
    },
    y: {
      kind: 'number',
      name: 'y',
      description: '',
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      control: 'slider',
    },
  },
}
