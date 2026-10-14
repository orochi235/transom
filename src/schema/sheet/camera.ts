import type { PrefGroup } from '@weasel-js/prefs'
import { to } from '@/schema/pointer.ts'

export const camera: PrefGroup = {
  name: 'camera & input',
  children: {
    camera: {
      name: 'camera',
      children: {
        fovDeg: to('camera.fovDeg'),
        standoff: to('camera.standoff'),
        yawDeg: to('camera.yawDeg'),
        pitchDeg: to('camera.pitchDeg'),
        margins: {
          name: 'margins',
          children: {
            '0': to('camera.margins.0'),
            '1': to('camera.margins.1'),
          },
        },
        homeMargin: to('camera.homeMargin'),
        zoomOutRoom: to('camera.zoomOutRoom'),
        moveMs: to('camera.moveMs'),
      },
    },
    nav: {
      name: 'nav',
      children: {
        wheelThreshold: to('nav.wheelThreshold'),
        pinchThreshold: to('nav.pinchThreshold'),
        quietMs: to('nav.quietMs'),
        floorMs: to('nav.floorMs'),
        orbit: to('nav.orbit'),
        dragCardSetsStep: to('nav.dragCardSetsStep'),
        dragDepthPerNotch: to('nav.dragDepthPerNotch'),
      },
    },
  },
}
