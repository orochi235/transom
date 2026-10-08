import { useEffect, useRef, useState } from 'react'
import { metaOf, statusOf } from '@/lightbox-meta.ts'
import { actions } from '@/actions.ts'
import { mountMesh } from '@/MeshView.ts'
import type { WallItem } from '@shared/protocol.ts'

/**
 * A mesh is the one artifact the lightbox draws rather than hands to the
 * browser: `/orig` serves the model and three turns it, framed and lit as the
 * card's poster was.
 *
 * Separate for the same reason `VideoLightbox` is — the image path's pan, zoom
 * and drag state means nothing for an orbit, and a branch above those hooks
 * would change the hook count when the arrows page from a picture to a mesh on
 * the same element.
 */
export function MeshLightbox({
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
  const host = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const view = mountMesh(el, item.origUrl, {
      stl: /\.stl$/i.test(item.path),
      onError: setFailed,
    })
    return () => view.dispose()
  }, [item.origUrl, item.path])

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Model"
      data-closing={closing ? '' : undefined}
      // The surround closes it; a press that lands on the canvas is an orbit.
      onClick={(e) => {
        if (e.target !== host.current?.firstChild) onClose()
      }}
    >
      <div className="lightbox__mesh" ref={host} />
      {failed && <p className="lightbox__meshFailed">this model {failed}</p>}

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
        {/* What the card cannot say: this one is turnable. */}
        <span className="lightbox__metaPart">drag to turn</span>
        <button
          type="button"
          className="lightbox__metaPart lightbox__metaButton"
          onClick={() => actions.openInApp(item.id)}
        >
          open in app
        </button>
      </div>
      {item.name && <figcaption className="lightbox__caption">{item.name}</figcaption>}
    </div>
  )
}
