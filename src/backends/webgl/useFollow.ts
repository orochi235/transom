import { useCallback, useEffect } from 'react'
import { cyclesFollow } from '@/nav/keys.ts'
import { follows, nextFollow } from '@/params/follow.ts'
import { cardOf, zoneOf, type ViewAction, type ViewState } from '@/view-state.ts'
import type { Props } from '@/backends/webgl/types.ts'
import type { WallItem } from '@shared/protocol.ts'

/**
 * An open lightbox moving to each artifact as it lands, in its own stack or
 * anywhere, per `follow.arrivals`; and F, which steps that pref. Only the
 * filtered wall is followed, so a band narrowed to images never jumps to a video.
 */
export function useFollow(
  props: Pick<Props, 'arrival' | 'params' | 'onParams'>,
  shown: readonly WallItem[],
  view: ViewState,
  dispatch: (action: ViewAction) => void,
) {
  const mode = props.params.follow.arrivals
  const { arrival, onParams } = props

  // Keyed on the arrival alone: the view and the mode are read as they stand
  // when it lands, and changing either must not replay an old one.
  useEffect(() => {
    const zone = zoneOf(view)
    if (!arrival || cardOf(view) === null || zone === null) return
    if (cardOf(view) === arrival.id || !follows(mode, zone, arrival)) return
    if (!shown.some((i) => i.id === arrival.id)) return
    dispatch({ type: 'to', path: [arrival.zone, arrival.id] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrival])

  const cycle = useCallback(
    () => onParams((p) => ({ ...p, follow: { ...p.follow, arrivals: nextFollow(p.follow.arrivals) } })),
    [onParams],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element | null)?.closest?.('input, select, textarea, [contenteditable]')) return
      if (cyclesFollow(e)) cycle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cycle])

  return { mode, cycle }
}
