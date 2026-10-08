import { type Dispatch, useCallback, useEffect, useRef, useState } from 'react'
import { actions } from '@/actions.ts'
import type { MenuAt } from '@/menu/CardMenu.tsx'
import { copyArtifact } from '@/menu/copy.ts'
import type { Action } from '@/menu/items.ts'
import { cardOf, type ViewAction, type ViewState } from '@/view-state.ts'
import { posterTake } from '@shared/groups.ts'
import type { WallItem } from '@shared/protocol.ts'
import type { Props } from '@/backends/webgl/types.ts'

export function useCardMenu(
  props: Pick<Props, 'items' | 'onConfigureZone'>,
  items: WallItem[],
  view: ViewState,
  dispatch: Dispatch<ViewAction>,
  dismiss: (id: string) => void,
) {
  const [menu, setMenu] = useState<MenuAt | null>(null)
  /** Set by the first expiry this client asks for. The daemon holds one undo,
   *  and the wall cannot see whether it is still loaded — so this only says
   *  that something has been expired from here, and the route answers for the
   *  rest. */
  const [expired, setExpired] = useState(false)
  const onMenu = useCallback((at: MenuAt) => setMenu(at), [])

  const menuTarget = menu?.target
  const menuItem =
    menuTarget?.kind === 'card' ? items.find((i) => i.id === menuTarget.id) : undefined

  const viewNow = useRef(view)
  viewNow.current = view
  /** One card undone while a card is open, held until its `arrive` lands:
   *  opened before then, the prune bounces the view off a card the wall lacks. */
  const [reopen, setReopen] = useState<string | null>(null)
  const undo = useCallback(() => {
    void actions.undo().then((restored) => {
      if (restored.length === 1 && cardOf(viewNow.current)) setReopen(restored[0]!)
    })
  }, [])
  useEffect(() => {
    const item = reopen === null ? undefined : props.items.find((i) => i.id === reopen)
    if (!item) return
    setReopen(null)
    dispatch({ type: 'to', path: [item.zone, item.id] })
  }, [reopen, props.items])

  /** The menu row clicked once and waiting to be meant. Cleared with the menu,
   *  so arming never survives the gesture that armed it. */
  const [armed, setArmed] = useState<Action | null>(null)
  // A card's zone as well as a zone's own: the card menu offers to zip the
  // pile the card is in, and the row says how many that is.
  const menuZone = menuTarget && 'zone' in menuTarget ? menuTarget.zone : null
  const zoneCount = menuZone === null ? 0 : items.filter((i) => i.zone === menuZone).length

  const act = useCallback(
    (action: Action, app?: number) => {
      const target = menu?.target
      // Two clicks, not a `confirm()`: a browser modal blocks the page's event
      // loop, and this is the one action that can take a whole zone.
      if (action === 'expireZone' && target?.kind === 'zone') {
        if (armed !== 'expireZone') return setArmed('expireZone')
        setArmed(null)
        setMenu(null)
        setExpired(true)
        return actions.expireZone(target.zone)
      }
      if (action === 'configureZone' && target?.kind === 'zone') {
        setArmed(null)
        setMenu(null)
        return props.onConfigureZone(target.zone)
      }
      if (action === 'zipZone' && target && 'zone' in target) {
        setArmed(null)
        setMenu(null)
        return actions.zipZone(target.zone)
      }
      if ((action === 'pinZone' || action === 'unpinZone') && target?.kind === 'zone') {
        setArmed(null)
        setMenu(null)
        return actions.pinZone(target.zone, action === 'pinZone')
      }
      setArmed(null)
      setMenu(null)
      if (action === 'undo') return undo()
      if (target?.kind !== 'card') return
      const id = target.id
      if (action === 'open') return void dispatch({ type: 'to', path: [target.zone, id] })
      if (action === 'openInApp' && menuItem && app !== undefined) {
        // A group's apps belong to the take on the card, so the open is addressed
        // to that take rather than to the card that is drawing it.
        const shown = posterTake(menuItem.takes ?? [])
        return actions.openInApp(shown?.id ?? id, app)
      }
      if (action === 'dismiss') return dismiss(id)
      if (action === 'zipGroup') return actions.zipGroup(id)
      if (action === 'copyArtifact' && menuItem)
        return void copyArtifact(menuItem).catch((e) => console.warn('[menu] copy failed', e))
      if (action === 'copyPath' && menuItem)
        return void navigator.clipboard?.writeText(menuItem.path).catch(() => {})
      if (action === 'pin' || action === 'unpin') return actions.keep(id, action === 'pin')
      if (action === 'expire') {
        setExpired(true)
        return actions.expire(id)
      }
    },
    [menu, menuItem, dispatch, dismiss, undo, armed, props.onConfigureZone],
  )

  const deleteCard = useCallback((id: string) => {
    setExpired(true)
    actions.expire(id)
  }, [])

  return { menu, setMenu, onMenu, menuItem, menuZone, zoneCount, expired, armed, setArmed, act, deleteCard, undo }
}
