import type { PrefGroup } from '@weasel-js/prefs'

export const jitter: PrefGroup = {
  name: 'jitter',
  children: {
    rot: {
      kind: 'number',
      name: 'rot',
      description: '',
      default: 0,
      min: 0,
      max: 0.5,
      step: 0.005,
      control: 'slider',
    },
    pos: {
      kind: 'number',
      name: 'pos',
      description: '',
      default: 0,
      min: 0,
      max: 0.1,
      step: 0.001,
      control: 'slider',
    },
  },
}
