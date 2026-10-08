import { type Dispatch, useCallback, useEffect, useRef, useState } from 'react'
import { actions } from '@/actions.ts'
import type { ViewAction } from '@/view-state.ts'
import type { WallItem } from '@shared/protocol.ts'

/** How long a reply shows before the lightbox goes, and how long it takes to
 *  go — the second matches `lightbox-out` in lightbox.css. */
const REPLY_HOLD_MS = 1000
const REPLY_CLOSE_MS = 240

export function useReplies(card: string | null, dispatch: Dispatch<ViewAction>, dismiss: (id: string) => void) {
  // Replying in the lightbox holds long enough to see the reply land, then
  // plays the lightbox out. Called off if the viewer has moved on by then.
  const [closing, setClosing] = useState<string | null>(null)
  const openCard = useRef(card)
  openCard.current = card
  /** The artifact the lightbox is showing, for the callbacks below, which are
   *  bound once and so cannot read it from the render. Set where `lit` is. */
  const openItem = useRef<WallItem | null>(null)
  const leaving = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => leaving.current.forEach(clearTimeout), [])
  const leaveAfterReply = useCallback((id: string) => {
    leaving.current.forEach(clearTimeout)
    leaving.current = [
      setTimeout(() => {
        if (openCard.current !== id) return
        setClosing(id)
        leaving.current.push(
          setTimeout(() => {
            setClosing(null)
            if (openCard.current === id) dispatch({ type: 'out' })
          }, REPLY_CLOSE_MS),
        )
      }, REPLY_HOLD_MS),
    ]
  }, [])

  // A group holds the lightbox open until nothing in it is waiting: a reply to
  // the third of twelve takes is not a reason to put the viewer back on the
  // wall. `lit` is read through a ref because these are bound once.
  const lastOpenQuestion = useCallback((id: string, take?: string) => {
    const item = openItem.current
    if (item?.id !== id || item.kind !== 'group') return true
    const waiting = (item.takes ?? []).filter((t) => t.question !== undefined && t.reply === undefined)
    return waiting.length <= 1 && (take === undefined || waiting[0]?.id === take)
  }, [])
  const answer = useCallback(
    (id: string, reply: { choice?: string; text: string; take?: string }) => {
      actions.answer(id, reply)
      if (lastOpenQuestion(id, reply.take)) leaveAfterReply(id)
    },
    [lastOpenQuestion, leaveAfterReply],
  )
  const dismissInLightbox = useCallback(
    (id: string, take?: string) => {
      if (take === undefined) dismiss(id)
      else actions.dismiss(id, 'close', take)
      if (lastOpenQuestion(id, take)) leaveAfterReply(id)
    },
    [dismiss, lastOpenQuestion, leaveAfterReply],
  )

  return { closing, openItem, answer, dismissInLightbox }
}
