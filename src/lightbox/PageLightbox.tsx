import { useEffect, useRef } from 'react'
import { metaOf, statusOf } from '@/lightbox-meta.ts'
import { sandboxFor } from '@/lightbox-sandbox.ts'
import { KEY_MESSAGE } from '@shared/page-keys.ts'
import type { WallItem } from '@shared/protocol.ts'

/**
 * A page runs rather than being drawn: the same `/orig` an image lightbox
 * loads into an `<img>` is an HTML file here, so the frame shows the artifact
 * itself, live.
 *
 * None of the image path's pan, zoom, drag or resize state means anything for
 * a frame that scrolls itself, which is why this is a separate component and
 * not a branch inside one — a branch above those hooks would change the hook
 * count when the arrows page from an image to a page on the same element.
 */
export function PageLightbox({
  item,
  now,
  closing,
  onClose,
}: {
  item: WallItem
  now: number
  closing: boolean
  onClose: () => void
}) {
  const sandbox = sandboxFor(item.sandbox)
  const root = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)

  // The wall navigates on a `window` wheel listener. A wheel inside a
  // same-origin frame never leaves it, but one over the margin around the
  // frame would, and the wall would step out a rung under the page.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const onWheel = (e: WheelEvent) => e.stopPropagation()
    el.addEventListener('wheel', onWheel)
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // The keys the page hands back, replayed where the wall already listens for
  // them. The frame is an opaque origin, so `event.origin` is "null" for every
  // page alike and the frame's own window is the only thing worth checking.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      const data = e.data as { type?: string; key?: string; shiftKey?: boolean } | null
      if (data?.type !== KEY_MESSAGE || !data.key) return
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: data.key, shiftKey: !!data.shiftKey, bubbles: true }),
      )
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <div
      className="lightbox"
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="Page"
      data-closing={closing ? '' : undefined}
      // Every part of the surround, not just the margin: a click inside the
      // frame is delivered to the page's own document and never arrives here,
      // so anything that does arrive landed beside the page.
      onClick={(e) => {
        if (e.target !== frame.current) onClose()
      }}
    >
      <iframe
        className="lightbox__page"
        ref={frame}
        src={`/page/${item.id}`}
        title={item.name || 'page'}
        {...(sandbox === null ? {} : { sandbox })}
      />

      {/* The wall's Escape is a `window` listener, and a keystroke inside an
          opaque-origin frame never reaches it. Once the pointer is in the
          page this is the only way out that is visible. */}
      <button type="button" className="lightbox__close" onClick={onClose}>
        ✕ close
      </button>

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
      </div>
      {item.name && <figcaption className="lightbox__caption">{item.name}</figcaption>}
    </div>
  )
}
