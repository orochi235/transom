import type { PrefGroup } from '@weasel-js/prefs'

export const menu: PrefGroup = {
  name: 'menu',
  children: {
    mode: {
      kind: 'enum',
      name: 'mode',
      description: '',
      default: 'tilt',
      options: [
        { value: 'window', label: 'window' },
        { value: 'tilt', label: 'tilt' },
      ],
    },
    step: {
      kind: 'number',
      name: 'step',
      description: '',
      default: 16,
      min: 0,
      max: 40,
      step: 1,
      control: 'slider',
    },
    swing: {
      kind: 'number',
      name: 'swing',
      description: '',
      default: 40,
      min: 0,
      max: 120,
      step: 2,
      control: 'slider',
    },
    tilt: {
      kind: 'number',
      name: 'tilt',
      description: '',
      default: 12,
      min: 0,
      max: 30,
      step: 1,
      control: 'slider',
    },
  },
}
