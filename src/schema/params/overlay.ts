import type { PrefGroup } from '@weasel-js/prefs'

export const overlay: PrefGroup = {
  name: 'overlay',
  children: {
    cardEdges: {
      kind: 'boolean',
      name: 'card edges',
      description: '',
      default: false,
    },
    cardEdgeWidth: {
      kind: 'number',
      name: 'card edge width',
      description: '',
      default: 1,
      min: 0.5,
      max: 12,
      step: 0.5,
      control: 'slider',
    },
    filterDim: {
      kind: 'number',
      name: 'filter dim',
      description: '',
      default: 0.12,
      min: 0,
      max: 1,
      step: 0.01,
      control: 'slider',
    },
  },
}
