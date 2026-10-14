import type { PrefGroup } from '@weasel-js/prefs'

export const rot: PrefGroup = {
  name: 'rot',
  children: {
    x: {
      kind: 'number',
      name: 'x',
      description: '',
      default: -0.12,
      min: -1.5,
      max: 1.5,
      step: 0.01,
      control: 'slider',
    },
    y: {
      kind: 'number',
      name: 'y',
      description: '',
      default: 0.34,
      min: -1.5,
      max: 1.5,
      step: 0.01,
      control: 'slider',
    },
  },
}
