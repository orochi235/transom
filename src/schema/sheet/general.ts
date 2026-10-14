import type { PrefGroup } from '@weasel-js/prefs'
import { to } from '@/schema/pointer.ts'

export const general: PrefGroup = {
  name: 'general',
  children: {
    general: {
      name: 'general',
      children: {
        parallax: to('general.parallax'),
      },
    },
    camera: {
      name: 'camera',
      children: {
        projection: to('camera.projection'),
      },
    },
    typeface: {
      name: 'typeface',
      children: {
        chrome: to('typeface.chrome'),
      },
    },
  },
}
