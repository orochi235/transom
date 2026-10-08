import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import { metaOf, statusOf } from '@/lightbox-meta.ts'
import { actions } from '@/actions.ts'
import { createQuietGate } from '@/nav/quiet.ts'
import { Markup, type Box, type MarkedUp } from '@/lightbox/Markup.tsx'
import { ImageLoupe } from '@/lightbox/Loupe.tsx'
import { usePersistedFlag } from '@/usePersistedFlag.ts'
import {
  barsOf,
  boxOf,
  markingView,
  fitView,
  isPanorama,
  isZoomed,
  openView,
  togglePanorama,
  panBy,
  toggleScale,
  zoomByWheel,
  zoomTo,
  type Size,
  type View,
} from '@/lightbox/view.ts'
import type { WallItem } from '@shared/protocol.ts'

const portOf = (): Size => ({ w: window.innerWidth, h: window.innerHeight })

/** Below this a pointer press is a click, above it a pan. Matches the wall's
 *  own slop, so a hand that is steady enough to pick a card there is steady
 *  enough to pick one here. */
const DRAG_SLOP_PX = 4

/**
 * A DOM overlay, not a GL quad: full resolution costs the texture budget
 * nothing here, and right-click-save, copy and drag-to-Finder keep working.
 *
 * The viewport under the image is the size of the window, because it is what
 * the pan is held inside — but that means it also covers the scrim, so closing
 * on a click outside the picture is its job rather than the backdrop's.
 */
export function ImageLightbox({
  item,
  now,
  quietMs,
  closing,
  onClose,
}: {
  item: WallItem
  now: number
  quietMs: number
  closing: boolean
  onClose: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [image, setImage] = useState<Size>({ w: 0, h: 0 })
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 })
  /** Set by a discrete zoom — a key or a double-click — and cleared by anything
   *  continuous. Easing a wheel or a drag makes it lag the hand instead. */
  const [eased, setEased] = useState(false)
  /** Drawing on the picture. The view is held at fit while it is, since the
   *  marks are laid down in the picture's on-screen box. */
  const [marking, setMarking] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendFailed, setSendFailed] = useState(false)
  const markingRef = useRef(marking)
  markingRef.current = marking
  /** Up while Alt is held over the picture. The wheel is the lens's then. */
  const [peeking, setPeeking] = useState(false)
  const peekingRef = useRef(peeking)
  peekingRef.current = peeking
  const [color, setColor] = useState<string | null>(null)
  const [smooth, setSmooth] = usePersistedFlag('transom.loupe.smooth', false)
  const port = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)
  /** The window size the current view was computed against. Read by the resize
   *  handler, which has to know whether the image was fitted before it moved. */
  const size = useRef<Size>(portOf())
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  /** False until the wheel stream has gone quiet once. The flick that opened
   *  this image is still arriving, and it has already been paid for. */
  const armed = useRef(false)
  /** The live view and the live `onClose`, for the wheel handler: it is bound
   *  once per image, and rebinding it per render would rebuild the quiet gate
   *  under a stream it is in the middle of reading. */
  const viewRef = useRef(view)
  viewRef.current = view
  const close = useRef(onClose)
  close.current = onClose

  // The id changes when the viewer moves between images without closing. The
  // view goes back to fit with it: paging a pile is no way to land inside the
  // corner of the next card.
  useEffect(() => {
    setLoaded(false)
    setImage({ w: 0, h: 0 })
    setView({ scale: 1, x: 0, y: 0 })
    setMarking(false)
    armed.current = false
  }, [item.id])

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

  const onLoad = useCallback(() => {
    const el = img.current
    if (!el) return
    const natural = { w: el.naturalWidth, h: el.naturalHeight }
    size.current = portOf()
    setImage(natural)
    // Drawing again swaps a held composite back for the original, and the
    // load that follows must not move the picture out from under the marks.
    setView(markingRef.current ? markingView(natural, size.current) : openView(natural, size.current))
    setLoaded(true)
    // A visible element can take focus, and until the first paint this one is
    // still transparent. Focus is what decides the wheel is ours.
    port.current?.focus()
  }, [])

  const startMarking = () => {
    setEased(false)
    setView(markingView(image, size.current))
    setSendFailed(false)
    setMarking(true)
  }
  const sendMarks = async (marked: MarkedUp) => {
    setSending(true)
    const ok = await actions.markUp(item.id, marked)
    setSending(false)
    setSendFailed(!ok)
    if (ok) setMarking(false)
  }
  const box: Box = boxOf(view, image, size.current)
  // A drawing that has not reached its sender is shown on the picture, so the
  // card says what it is holding. Drawing again starts from the original.
  const pending = item.markup?.status === 'pending'
  const src = pending && !marking ? item.markup!.url : item.origUrl

  const zoomed = isZoomed(view, image, size.current)
  // How much of the image is off screen, per axis. Null on an axis that fits.
  const bars = barsOf(view, image, size.current)

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
  /** The anchor for a zoom nobody pointed at — the middle of the window, so a
   *  toggle from the meta row keeps the middle of the picture in the middle. */
  const center = () => ({ x: size.current.w / 2, y: size.current.h / 2 })

  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    setEased(true)
    setView((v) => zoomTo(v, toggleScale(v, image, size.current), at(e), image, size.current))
  }

  // Arrows and Escape are deliberately not here: they belong to the wall, which
  // pages the pile and closes the lightbox with them from its own listener.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const middle = { x: size.current.w / 2, y: size.current.h / 2 }
    const step = (by: number) =>
      setView((v) => zoomTo(v, v.scale * by, middle, image, size.current))
    // By code: on a Mac, Alt turns the S key's `key` into ß.
    if (e.altKey && e.code === 'KeyS') {
      e.preventDefault()
      return setSmooth((on) => !on)
    }
    if (e.key === '0') {
      e.preventDefault()
      setEased(true)
      return setView(fitView(image, size.current))
    }
    if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      setEased(true)
      return step(1.25)
    }
    if (e.key === '-' || e.key === '_') {
      e.preventDefault()
      setEased(true)
      return step(1 / 1.25)
    }
  }

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Full resolution image"
      data-closing={closing ? '' : undefined}
      data-marking={marking ? '' : undefined}
    >
      <div
        className="lightbox__port"
        ref={port}
        tabIndex={0}
        data-zoomed={zoomed ? '' : undefined}
        data-eased={eased ? '' : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        style={{
          // Numbers, not rules: the transform itself is in the stylesheet. A
          // pan and a zoom change every frame and cannot be a class.
          '--lb-scale': view.scale,
          '--lb-x': `${view.x}px`,
          '--lb-y': `${view.y}px`,
          '--lb-w': `${image.w}px`,
          '--lb-h': `${image.h}px`,
        } as CSSProperties}
      >
        <img
          className={`lightbox__img ${loaded ? 'lightbox__img--in' : ''}`}
          ref={img}
          src={src}
          alt=""
          // Suppressed only once the drag means a pan; at fit the native drag
          // to Finder is the more useful of the two.
          draggable={!zoomed}
          data-sharp={view.scale > 2 ? '' : undefined}
          onLoad={onLoad}
        />
        {loaded && !marking && (
          <ImageLoupe img={img} host={port} box={box} smooth={smooth} onShown={setPeeking} onColor={setColor} />
        )}
        {/* What a scrollbar says and nothing it does: the image is placed by a
            transform, so there is no scroll offset for a real one to ride on.
            Drag, scroll and the keys are how it moves. */}
        {bars.x && (
          <div
            className="lightbox__bar lightbox__bar--x"
            aria-hidden="true"
            style={{ '--lb-bar': bars.x.size, '--lb-bar-at': bars.x.at } as CSSProperties}
          />
        )}
        {bars.y && (
          <div
            className="lightbox__bar lightbox__bar--y"
            aria-hidden="true"
            style={{ '--lb-bar': bars.y.size, '--lb-bar-at': bars.y.at } as CSSProperties}
          />
        )}
      </div>

      {/* Above the image, where the caption cannot go: what this is and how
          long it has left is context for the picture, not part of it. */}
      <div className="lightbox__meta">
        {statusOf(item).map((part) => (
          <span className="lightbox__metaPart lightbox__status" key={part}>
            {part}
          </span>
        ))}
        {metaOf(item, now).map((part) => (
          <span className="lightbox__metaPart" key={part}>
            {part}
          </span>
        ))}
        {/* Only where fitting makes a sliver. A panorama opens filled and this
            is the way to the whole of it; every other image is already whole,
            and a button offering to shrink it would mean nothing. */}
        {loaded && isPanorama(image, size.current) && (
          <button
            type="button"
            className="lightbox__metaPart lightbox__metaButton"
            onClick={() =>
              setView((v) =>
                zoomTo(v, togglePanorama(v, image, size.current), center(), image, size.current),
              )
            }
          >
            {isZoomed(view, image, size.current) ? 'whole' : 'fill'}
          </button>
        )}
        {loaded && !marking && (
          <button type="button" className="lightbox__metaPart lightbox__metaButton" onClick={startMarking}>
            mark up
          </button>
        )}
        {pending && !marking && (
          <button
            type="button"
            className="lightbox__metaPart lightbox__metaButton"
            onClick={() => actions.discardMarkup(item.id)}
          >
            discard marks
          </button>
        )}
        {peeking && <span className="lightbox__metaPart">{smooth ? 'smooth' : 'pixels'} · ⌥S</span>}
        {peeking && color && <span className="lightbox__metaPart lightbox__hex">{color}</span>}
        {/* Last in the row: it changes on every wheel notch, and anything after
            a readout that changes width is a control that shifts under the
            hand. */}
        {zoomed && (
          <span className="lightbox__metaPart lightbox__zoom">
            {Math.round(view.scale * 100)}%
          </span>
        )}
      </div>
      {marking && (
        <Markup
          src={item.origUrl}
          box={box}
          natural={image}
          sending={sending}
          failed={sendFailed}
          onSend={(marked) => void sendMarks(marked)}
          onCancel={() => setMarking(false)}
        />
      )}
      {item.name && <figcaption className="lightbox__caption">{item.name}</figcaption>}
    </div>
  )
}
