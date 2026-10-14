import type { PrefGroup } from '@weasel-js/prefs'
import { to } from '@/schema/pointer.ts'

export const zones: PrefGroup = {
  name: 'zones & sky',
  children: {
    typeface: {
      name: 'typeface',
      children: {
        label: to('typeface.label'),
      },
    },
    zones: {
      name: 'zones',
      children: {
        outline: to('zones.outline'),
        outlineWidth: to('zones.outlineWidth'),
        labels: to('zones.labels'),
        labelSize: to('zones.labelSize'),
        labelOffset: to('zones.labelOffset'),
        labelAlign: to('zones.labelAlign'),
        backdrop: to('zones.backdrop'),
        huedFrame: to('zones.huedFrame'),
        huedBackdrop: to('zones.huedBackdrop'),
        huedCardEdge: to('zones.huedCardEdge'),
        huedMinLight: to('zones.huedMinLight'),
        backdropOpacity: to('zones.backdropOpacity'),
        hatchWidth: to('zones.hatchWidth'),
      },
    },
    sky: {
      name: 'sky',
      children: {
        enabled: to('sky.enabled'),
        spreadDeg: to('sky.spreadDeg'),
        scale: to('sky.scale'),
        octaves: to('sky.octaves'),
        intensity: to('sky.intensity'),
        contrast: to('sky.contrast'),
        starDensity: to('sky.starDensity'),
        starIntensity: to('sky.starIntensity'),
      },
    },
    colors: {
      name: 'colors',
      children: {
        zoneIdle: to('colors.zoneIdle'),
        zoneFocus: to('colors.zoneFocus'),
        zoneBackdrop: to('colors.zoneBackdrop'),
        label: to('colors.label'),
        skyBase: to('colors.skyBase'),
        skyGlow: to('colors.skyGlow'),
      },
    },
  },
}
