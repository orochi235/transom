import type { PrefGroup } from '@weasel-js/prefs'

export const kept: PrefGroup = {
  name: 'kept',
  children: {
    height: {
      kind: 'number',
      name: 'height',
      description: '',
      default: 0.22,
      min: 0.08,
      max: 0.5,
      step: 0.01,
      control: 'slider',
    },
    gap: {
      kind: 'number',
      name: 'gap',
      description: '',
      default: 0.02,
      min: 0,
      max: 0.1,
      step: 0.002,
      control: 'slider',
    },
  },
}
