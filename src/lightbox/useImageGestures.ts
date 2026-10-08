import { useEffect, useRef } from 'react'
import type { Dispatch, MouseEvent, MutableRefObject, PointerEvent, RefObject, SetStateAction } from 'react'
import { createQuietGate } from '@/nav/quiet.ts'
import {
  barsOf,
  isZoomed,
  openView,
  panBy,
  toggleScale,
  zoomByWheel,
  zoomTo,
  type Size,
  type View,
} from '@/lightbox/view.ts'

export const portOf = (): Size => ({ w: window.innerWidth, h: window.innerHeight })

/** Below this a pointer press is a click, above it a pan. Matches the wall's
 *  own slop, so a hand that is steady enough to pick a card there is steady
 *  enough to pick one here. */
const DRAG_SLOP_PX = 4

/**
 * How the hand moves the picture inside the lightbox's port: the wheel and a
 * pinch, a drag, a double-click, a window resize, and the click beside the
 * picture that closes it.
 */
export function useImageGestures({
  port,
  img,
  image,
  size,
  view,
  setView,
  setEased,
  zoomed,
  peeking,
  armed,
  quietMs,
  onClose,
}: {
  port: RefObject<HTMLDivElement | null>
  img: RefObject<HTMLImageElement | null>
  image: Size
  size: MutableRefObject<Size>
  view: View
  setView: Dispatch<SetStateAction<View>>
  setEased: Dispatch<SetStateAction<boolean>>
  zoomed: boolean
  peeking: boolean
  armed: MutableRefObject<boolean>
  quietMs: number
  onClose: () => void
}) {
  const peekingRef = useRef(peeking)
  peekingRef.current = peeking
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  /** The live view and the live `onClose`, for the wheel handler: it is bound
   *  once per image, and rebinding it per render would rebuild the quiet gate
   *  under a stream it is in the middle of reading. */
  const viewRef = useRef(view)
  viewRef.current = view
  const close = useRef(onClose)
  close.current = onClose

  // The wheel is the lightbox's while the lightbox holds focus, and the wall's
  // otherwise — the browser's own arbitration rather than a mode of our own.
  // Not React's `onWheel`, which is attached passive at the root and cannot
  // call `preventDefault`. Stopping it here is also what keeps it from reaching
  // the wall's window listener, which would otherwise step out a rung under us.
  useEffect(() => {
    const el = port.current
    if (!el) return
    // `timeStamp` on a wheel event and `performance.now()` share the document's
    // time origin, so this effect's own start is a gap the tail cannot open.
    const gate = createQuietGate(quietMs, performance.now())
    const onWheel = (e: WheelEvent) => {
      if (!el.contains(document.activeElement)) return
      e.preventDefault()
      // Swallowed even while disarmed, or the tail reaches the wall's window
      // listener and steps a rung back out from under the image that opened.
      e.stopPropagation()
      if (peekingRef.current) return
      const fresh = gate.feed(e.timeStamp)
      if (fresh) armed.current = true
      if (!armed.current) return
      setEased(false)
      // A pinch arrives as a wheel with `ctrlKey` set, so the modifier is the
      // zoom gesture on a trackpad as well as under a key.
      if (e.ctrlKey || e.metaKey) {
        setView((v) => zoomByWheel(v, e.deltaY, { x: e.clientX, y: e.clientY }, image, size.current))
        return
      }
      // Scroll moves the image while any of it is off screen — the window
      // panning over the picture, so the direction matches the bars and every
      // other scrollable thing.
      const bars = barsOf(viewRef.current, image, size.current)
      if (bars.x || bars.y) {
        setView((v) => panBy(v, -e.deltaX, -e.deltaY, image, size.current))
        return
      }
      // Whole on screen, there is nothing left to scroll, so an out-gesture
      // spends itself on the rung instead and the image closes — the inverse of
      // the flick that opened it. A fresh gesture only: a roll that pans to the
      // last edge stops there rather than carrying on out of the lightbox in
      // the same movement.
      if (fresh && e.deltaY > 0) close.current()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [image, quietMs])

  // The window is the viewport, so its size is half of every sum here. An image
  // that was fitted stays fitted; one that was zoomed keeps its scale and is
  // pulled back inside the new edges.
  useEffect(() => {
    const onResize = () => {
      const was = size.current
      const next = portOf()
      size.current = next
      setView((v) =>
        isZoomed(v, image, was)
          ? panBy(v, 0, 0, image, next)
          : // `openView`, not `fitView`: a panorama that was filled is at a
            // scale `isZoomed` reads as zoomed, so this arm only ever has an
            // image that was showing whole — and a panorama resized into a
            // window it now fits should still open filled rather than as a
            // sliver of the new one.
            openView(image, next),
      )
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [image])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    drag.current = { x: e.clientX, y: e.clientY, moved: false }
    port.current?.focus()
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const from = drag.current
    // Only once zoomed. At fit the image is left alone so that dragging it to
    // Finder and saving it from the browser's own menu keep working, which is
    // the state every artifact opens in.
    if (!from || !zoomed) return
    const dx = e.clientX - from.x
    const dy = e.clientY - from.y
    if (!from.moved && Math.hypot(dx, dy) < DRAG_SLOP_PX) return
    if (!from.moved) port.current?.setPointerCapture(e.pointerId)
    from.moved = true
    from.x = e.clientX
    from.y = e.clientY
    setEased(false)
    setView((v) => panBy(v, dx, dy, image, size.current))
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (port.current?.hasPointerCapture(e.pointerId))
      port.current.releasePointerCapture(e.pointerId)
    // Held until the click that follows has been judged, and cleared by it.
    if (drag.current && !drag.current.moved) drag.current = null
  }

  // The viewport covers the scrim, so the click that lands beside the picture
  // lands here. A pan that ends outside the image must not read as one.
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const panned = drag.current?.moved ?? false
    drag.current = null
    if (panned || e.target === img.current) return
    onClose()
  }

  const at = (e: { clientX: number; clientY: number }) => ({ x: e.clientX, y: e.clientY })

  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    setEased(true)
    setView((v) => zoomTo(v, toggleScale(v, image, size.current), at(e), image, size.current))
  }

  return { onPointerDown, onPointerMove, onPointerUp, onClick, onDoubleClick }
}
