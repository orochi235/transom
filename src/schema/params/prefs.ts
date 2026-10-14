import type { PrefGroup } from '@weasel-js/prefs'

export const prefs: PrefGroup = {
  name: 'prefs',
  children: {
    parallax: {
      kind: 'boolean',
      name: 'parallax',
      description: '',
      default: true,
    },
    step: {
      kind: 'number',
      name: 'step',
      description: '',
      default: 12,
      min: 0,
      max: 40,
      step: 1,
      control: 'slider',
    },
    perspective: {
      kind: 'number',
      name: 'perspective',
      description: '',
      default: 1400,
      min: 200,
      max: 2000,
      step: 10,
      control: 'slider',
    },
    swing: {
      kind: 'number',
      name: 'swing',
      description: '',
      default: 420,
      min: 0,
      max: 600,
      step: 5,
      control: 'slider',
    },
  },
}
