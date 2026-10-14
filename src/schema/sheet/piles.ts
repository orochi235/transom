import type { PrefGroup } from '@weasel-js/prefs'
import { to } from '@/schema/pointer.ts'

export const piles: PrefGroup = {
  name: 'piles',
  children: {
    step: {
      name: 'step',
      children: {
        x: to('step.x'),
        y: to('step.y'),
        z: to('step.z'),
      },
    },
    side: to('side'),
    origin: {
      name: 'origin',
      children: {
        x: to('origin.x'),
        y: to('origin.y'),
      },
    },
    rot: {
      name: 'rot',
      children: {
        x: to('rot.x'),
        y: to('rot.y'),
      },
    },
    jitter: {
      name: 'jitter',
      children: {
        rot: to('jitter.rot'),
        pos: to('jitter.pos'),
      },
    },
    shoveMs: to('shoveMs'),
    zoneGrid: {
      name: 'zone grid',
      children: {
        gap: to('zoneGrid.gap'),
        orientation: to('zoneGrid.orientation'),
        reverseX: to('zoneGrid.reverseX'),
        reverseY: to('zoneGrid.reverseY'),
        minCells: to('zoneGrid.minCells'),
        moveMs: to('zoneGrid.moveMs'),
      },
    },
    lod: {
      name: 'lod',
      children: {
        tiers: {
          name: 'tiers',
          children: {
            '0': {
              name: '0',
              children: {
                maxRank: to('lod.tiers.0.maxRank'),
                edge: to('lod.tiers.0.edge'),
              },
            },
            '1': {
              name: '1',
              children: {
                maxRank: to('lod.tiers.1.maxRank'),
                edge: to('lod.tiers.1.edge'),
              },
            },
            '2': {
              name: '2',
              children: {
                maxRank: to('lod.tiers.2.maxRank'),
                edge: to('lod.tiers.2.edge'),
              },
            },
            '3': {
              name: '3',
              children: {
                maxRank: to('lod.tiers.3.maxRank'),
                edge: to('lod.tiers.3.edge'),
              },
            },
          },
        },
        budgetBytes: to('lod.budgetBytes'),
        rankCap: to('lod.rankCap'),
      },
    },
  },
}
