import type { PrefGroup } from '@weasel-js/prefs'

export const chips: PrefGroup = {
  name: 'chips',
  children: {
    cards: {
      kind: 'boolean',
      name: 'cards',
      description: '',
      default: true,
    },
    zones: {
      kind: 'boolean',
      name: 'zones',
      description: '',
      default: true,
    },
    size: {
      kind: 'number',
      name: 'size',
      description: '',
      default: 0.03,
      min: 0.008,
      max: 0.12,
      step: 0.002,
      control: 'slider',
    },
    shrink: {
      kind: 'number',
      name: 'shrink',
      description: '',
      default: 0.45,
      min: 0.1,
      max: 1,
      step: 0.01,
      control: 'slider',
    },
    inset: {
      kind: 'number',
      name: 'inset',
      description: '',
      default: 0.006,
      min: 0,
      max: 0.05,
      step: 0.001,
      control: 'slider',
    },
    bleed: {
      kind: 'number',
      name: 'bleed',
      description: '',
      default: 0,
      min: -0.05,
      max: 0.05,
      step: 0.001,
      control: 'slider',
    },
  },
}
