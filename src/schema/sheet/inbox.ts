import type { PrefGroup } from '@weasel-js/prefs'
import { to } from '@/schema/pointer.ts'

export const inbox: PrefGroup = {
  name: 'inbox',
  children: {
    inbox: {
      name: 'inbox',
      children: {
        mode: to('inbox.mode'),
        gap: to('inbox.gap'),
        maxSide: to('inbox.maxSide'),
        floor: to('inbox.floor'),
        moveMs: to('inbox.moveMs'),
        big: to('inbox.big'),
        mid: to('inbox.mid'),
        lanes: to('inbox.lanes'),
      },
    },
  },
}
