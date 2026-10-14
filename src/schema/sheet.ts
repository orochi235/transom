import type { PrefGroup } from '@weasel-js/prefs'
import { general } from '@/schema/sheet/general.ts'
import { piles } from '@/schema/sheet/piles.ts'
import { inbox } from '@/schema/sheet/inbox.ts'
import { cards } from '@/schema/sheet/cards.ts'
import { flags } from '@/schema/sheet/flags.ts'
import { zones } from '@/schema/sheet/zones.ts'
import { camera } from '@/schema/sheet/camera.ts'
import { chrome } from '@/schema/sheet/chrome.ts'

export type SheetPage = { id: string; root: PrefGroup }

/**
 * The prefs sheet's pages, in the order its column lists them. Each is a
 * layout of pointers into `PARAMS`, so a param sits on a page without its path
 * moving, and a saved set keeps loading. `general` leads and stands apart from
 * the rest: it is the few settings worth finding first, not an area of the wall.
 */
export const SHEET: readonly SheetPage[] = [
  { id: 'general', root: general },
  { id: 'piles', root: piles },
  { id: 'inbox', root: inbox },
  { id: 'cards', root: cards },
  { id: 'flags', root: flags },
  { id: 'zones', root: zones },
  { id: 'camera', root: camera },
  { id: 'chrome', root: chrome },
]
