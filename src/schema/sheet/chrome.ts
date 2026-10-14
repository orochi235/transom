import type { PrefGroup } from '@weasel-js/prefs'
import { to } from '@/schema/pointer.ts'

export const chrome: PrefGroup = {
  name: 'chrome',
  children: {
    menu: {
      name: 'menu',
      children: {
        mode: to('menu.mode'),
        step: to('menu.step'),
        swing: to('menu.swing'),
        tilt: to('menu.tilt'),
      },
    },
    band: {
      name: 'band',
      children: {
        shown: to('band.shown'),
        parallax: to('band.parallax'),
        step: to('band.step'),
        perspective: to('band.perspective'),
        swing: to('band.swing'),
      },
    },
    prefs: {
      name: 'prefs',
      children: {
        parallax: to('prefs.parallax'),
        step: to('prefs.step'),
        perspective: to('prefs.perspective'),
        swing: to('prefs.swing'),
      },
    },
    colors: {
      name: 'colors',
      children: {
        bg: to('colors.bg'),
        scrim: to('colors.scrim'),
        ink: to('colors.ink'),
        muted: to('colors.muted'),
        accent: to('colors.accent'),
        danger: to('colors.danger'),
      },
    },
  },
}
