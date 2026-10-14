import type { PrefGroup } from '@weasel-js/prefs'
import { choice } from '@/schema/kinds.ts'

export const lod: PrefGroup = {
  name: 'lod',
  children: {
    tiers: {
      name: 'tiers',
      children: {
        '0': {
          name: '0',
          children: {
            maxRank: {
              kind: 'number',
              name: 'max rank',
              description: '',
              default: 1,
              min: 0,
              max: 400,
              step: 1,
              control: 'slider',
            },
            edge: choice({
              name: 'edge',
              description: '',
              default: 512,
              options: [0, 32, 128, 512],
            }),
          },
        },
        '1': {
          name: '1',
          children: {
            maxRank: {
              kind: 'number',
              name: 'max rank',
              description: '',
              default: 8,
              min: 0,
              max: 400,
              step: 1,
              control: 'slider',
            },
            edge: choice({
              name: 'edge',
              description: '',
              default: 128,
              options: [0, 32, 128, 512],
            }),
          },
        },
        '2': {
          name: '2',
          children: {
            maxRank: {
              kind: 'number',
              name: 'max rank',
              description: '',
              default: 40,
              min: 0,
              max: 400,
              step: 1,
              control: 'slider',
            },
            edge: choice({
              name: 'edge',
              description: '',
              default: 32,
              options: [0, 32, 128, 512],
            }),
          },
        },
        '3': {
          name: '3',
          children: {
            maxRank: {
              kind: 'number',
              name: 'max rank',
              description: '',
              default: 9007199254740991,
            },
            edge: choice({
              name: 'edge',
              description: '',
              default: 0,
              options: [0, 32, 128, 512],
            }),
          },
        },
      },
    },
    budgetBytes: {
      kind: 'number',
      name: 'budget',
      description: '',
      default: 268435456,
      min: 16777216,
      max: 1073741824,
      step: 16777216,
      control: 'slider',
      unit: { suffix: ' MB', scale: 1048576 },
    },
    rankCap: {
      kind: 'number',
      name: 'rank cap',
      description: '',
      default: 88,
      min: 1,
      max: 400,
      step: 1,
      control: 'slider',
    },
    revealHoldMs: {
      kind: 'number',
      name: 'reveal hold',
      description: '',
      default: 1200,
      min: 0,
      max: 4000,
      step: 50,
      control: 'slider',
      unit: { suffix: 'ms', scale: 1 },
    },
    revealFadeMs: {
      kind: 'number',
      name: 'reveal fade',
      description: '',
      default: 250,
      min: 0,
      max: 1500,
      step: 25,
      control: 'slider',
      unit: { suffix: 'ms', scale: 1 },
    },
  },
}
