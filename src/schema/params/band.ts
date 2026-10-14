import type { PrefGroup } from '@weasel-js/prefs'

export const band: PrefGroup = {
  name: 'band',
  children: {
    shown: {
      kind: 'boolean',
      name: 'shown',
      description: '',
      default: true,
    },
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
      default: 20,
      min: 0,
      max: 40,
      step: 1,
      control: 'slider',
    },
    perspective: {
      kind: 'number',
      name: 'perspective',
      description: '',
      default: 500,
      min: 200,
      max: 1400,
      step: 10,
      control: 'slider',
    },
    swing: {
      kind: 'number',
      name: 'swing',
      description: '',
      default: 80,
      min: 0,
      max: 200,
      step: 2,
      control: 'slider',
    },
  },
}
