import type { PrefGroup } from '@weasel-js/prefs'

export const zoneGrid: PrefGroup = {
  name: 'zone grid',
  children: {
    gap: {
      kind: 'number',
      name: 'gap',
      description: '',
      default: 0.425,
      min: 0,
      max: 1,
      step: 0.005,
      control: 'slider',
    },
    orientation: {
      kind: 'enum',
      name: 'orientation',
      description: '',
      default: 'fit',
      options: [
        { value: 'wide', label: 'wide' },
        { value: 'tall', label: 'tall' },
        { value: 'fit', label: 'fit' },
      ],
    },
    reverseX: {
      kind: 'boolean',
      name: 'reverse x',
      description: '',
      default: false,
    },
    reverseY: {
      kind: 'boolean',
      name: 'reverse y',
      description: '',
      default: false,
    },
    minCells: {
      kind: 'number',
      name: 'min cells',
      description: '',
      default: 4,
      min: 1,
      max: 12,
      step: 1,
      control: 'slider',
    },
    moveMs: {
      kind: 'number',
      name: 'move',
      description: '',
      default: 520,
      min: 0,
      max: 3000,
      step: 10,
      control: 'slider',
      unit: { suffix: 'ms', scale: 1 },
    },
  },
}
