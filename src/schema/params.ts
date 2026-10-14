import type { PrefGroup } from '@weasel-js/prefs'
import { general } from '@/schema/params/general.ts'
import { step } from '@/schema/params/step.ts'
import { origin } from '@/schema/params/origin.ts'
import { rot } from '@/schema/params/rot.ts'
import { jitter } from '@/schema/params/jitter.ts'
import { fade } from '@/schema/params/fade.ts'
import { distance } from '@/schema/params/distance.ts'
import { chips } from '@/schema/params/chips.ts'
import { attention } from '@/schema/params/attention.ts'
import { zoneGrid } from '@/schema/params/zoneGrid.ts'
import { inbox } from '@/schema/params/inbox.ts'
import { camera } from '@/schema/params/camera.ts'
import { nav } from '@/schema/params/nav.ts'
import { menu } from '@/schema/params/menu.ts'
import { band } from '@/schema/params/band.ts'
import { prefs } from '@/schema/params/prefs.ts'
import { typeface } from '@/schema/params/typeface.ts'
import { overlay } from '@/schema/params/overlay.ts'
import { zones } from '@/schema/params/zones.ts'
import { sky } from '@/schema/params/sky.ts'
import { colors } from '@/schema/params/colors.ts'
import { lod } from '@/schema/params/lod.ts'

export const PARAMS: PrefGroup = {
  name: 'params',
  children: {
    side: {
      kind: 'number',
      name: 'side',
      description: '',
      default: 0.305,
      min: 0.02,
      max: 1,
      step: 0.005,
      control: 'slider',
    },
    shoveMs: {
      kind: 'number',
      name: 'shove',
      description: '',
      default: 420,
      min: 0,
      max: 3000,
      step: 10,
      control: 'slider',
      unit: { suffix: 'ms', scale: 1 },
    },
    general,
    step,
    origin,
    rot,
    jitter,
    fade,
    distance,
    chips,
    attention,
    zoneGrid,
    inbox,
    camera,
    nav,
    menu,
    band,
    prefs,
    typeface,
    overlay,
    zones,
    sky,
    colors,
    lod,
  },
}
