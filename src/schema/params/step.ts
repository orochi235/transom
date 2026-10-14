import type { PrefGroup } from '@weasel-js/prefs'

export const step: PrefGroup = {
  name: 'step',
  children: {
    x: {
      kind: 'number',
      name: 'x',
      description: '',
      default: -0.013,
      min: -0.1,
      max: 0.1,
      step: 0.001,
      control: 'slider',
    },
    y: {
      kind: 'number',
      name: 'y',
      description: '',
      default: -0.009,
      min: -0.1,
      max: 0.1,
      step: 0.001,
      control: 'slider',
    },
    z: {
      kind: 'number',
      name: 'z',
      description: '',
      default: -0.023,
      min: -0.2,
      max: 0,
      step: 0.001,
      control: 'slider',
      unit: { scale: -1 },
    },
  },
}
