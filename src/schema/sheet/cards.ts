import type { PrefGroup } from '@weasel-js/prefs'
import { to } from '@/schema/pointer.ts'

export const cards: PrefGroup = {
  name: 'cards',
  children: {
    fade: {
      name: 'fade',
      children: {
        from: to('fade.from'),
        to: to('fade.to'),
      },
    },
    distance: {
      name: 'distance',
      children: {
        enabled: to('distance.enabled'),
        from: to('distance.from'),
        to: to('distance.to'),
        floor: to('distance.floor'),
        combine: to('distance.combine'),
      },
    },
    chips: {
      name: 'chips',
      children: {
        cards: to('chips.cards'),
        zones: to('chips.zones'),
        size: to('chips.size'),
        shrink: to('chips.shrink'),
        inset: to('chips.inset'),
        bleed: to('chips.bleed'),
      },
    },
    kept: {
      name: 'kept',
      children: {
        height: to('kept.height'),
        gap: to('kept.gap'),
      },
    },
    overlay: {
      name: 'overlay',
      children: {
        cardEdges: to('overlay.cardEdges'),
        cardEdgeWidth: to('overlay.cardEdgeWidth'),
        filterDim: to('overlay.filterDim'),
      },
    },
    colors: {
      name: 'colors',
      children: {
        cardEdge: to('colors.cardEdge'),
        cardBlank: to('colors.cardBlank'),
        chipFill: to('colors.chipFill'),
        chipIcon: to('colors.chipIcon'),
        chipInk: to('colors.chipInk'),
      },
    },
    lod: {
      name: 'lod',
      children: {
        revealHoldMs: to('lod.revealHoldMs'),
        revealFadeMs: to('lod.revealFadeMs'),
      },
    },
  },
}
