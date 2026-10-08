import { useEffect, useRef, useState } from 'react'
import { metaOf, statusOf } from '@/lightbox-meta.ts'
import { actions } from '@/actions.ts'
import type { WallItem } from '@shared/protocol.ts'

/**
 * A video plays rather than being drawn: `/orig` hands the file to a `<video>`,
 * which is why the wall holds only containers the browser can play.
 *
 * Separate for the same reason `PageLightbox` is — the image path's pan, zoom
 * and drag state means nothing for native video controls, and a branch above
 * those hooks would change the hook count when the arrows page from a picture
 * to a video on the same element.
 */
/** How tall the browser's own video controls stand at the foot of the element.
 *  Chrome draws about forty; the few extra keep a press aimed at the scrubber
 *  from landing on the picture instead. */
const CONTROLS_BAND = 48

export function VideoLightbox({
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
  const video = useRef<HTMLVideoElement>(null)
  // Muted on every mount, never remembered: a side monitor that makes noise
  // because of something you did yesterday is the failure this avoids. It is
  // also what keeps Chrome's autoplay policy from ever blocking the play, so
  // there is no case where the video sits on its first frame waiting for a
  // second click.
  const [muted, setMuted] = useState(true)
  // Off unless asked for. A render is usually a few seconds and a wall that
  // repeats one forever is a wall that will not let it finish — the loop is
  // worth having for a cycle somebody wants to watch twice, not by default.
  const [looping, setLooping] = useState(false)
  /** Whether the press this click ends began on the picture rather than on the
   *  control strip. See the handlers below. */
  const onPicture = useRef(false)

  // Space, ahead of the wall's own handler, which reads it as "go in" and
  // takes it before a focused video ever sees it. Bound to the window rather
  // than the element for the same reason the element is left unfocused: the
  // arrows belong to the pile, so the video never holds focus to receive a
  // key through it.
  useEffect(() => {
    // `KeyboardEvent` is React's in this file, so the DOM one is named.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      // Typing a space is typing a space — a question's answer box is open on
      // the same card.
      if (target?.isContentEditable) return
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return
      const el = video.current
      if (!el) return
      e.preventDefault()
      e.stopPropagation()
      if (el.paused) void el.play()
      else el.pause()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Video"
      data-closing={closing ? '' : undefined}
      // The margin around the video, and nothing the viewer is aiming at: a
      // click on the element itself is either the controls or a play toggle.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <video
        className="lightbox__video"
        ref={video}
        src={item.origUrl}
        muted={muted}
        autoPlay
        loop={looping}
        playsInline
        controls
        // A click on the picture stops and starts it, the way a click on a
        // video anywhere else does. The native control strip is drawn inside
        // this same element and reports its clicks as the element's, so there
        // is no target to tell them apart by — the bottom band is left to the
        // controls by measure instead, or every press on play would arrive
        // here as well and undo itself.
        onPointerDown={(e) => {
          onPicture.current =
            e.clientY <= e.currentTarget.getBoundingClientRect().bottom - CONTROLS_BAND
        }}
        onClick={(e) => {
          const el = e.currentTarget
          // Both ends of the press, because a scrub dragged up out of the
          // strip releases over the picture and its click would otherwise
          // pause whatever the viewer just finished seeking to.
          if (!onPicture.current) return
          if (e.clientY > el.getBoundingClientRect().bottom - CONTROLS_BAND) return
          if (el.paused) void el.play()
          else el.pause()
        }}
        // Left unfocused on purpose: the wall's arrows page the pile, and a
        // focused video would take them for a seek before they got there.
        // Clicking it is how a viewer asks for that trade.
        tabIndex={-1}
      />

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
        <button
          type="button"
          className="lightbox__metaPart lightbox__metaButton"
          onClick={() => setMuted((m) => !m)}
        >
          {muted ? 'unmute' : 'mute'}
        </button>
        <button
          type="button"
          className="lightbox__metaPart lightbox__metaButton"
          aria-pressed={looping}
          onClick={() => setLooping((on) => !on)}
        >
          {looping ? 'once' : 'loop'}
        </button>
        {/* The browser cannot call `open`, so the daemon does. Worth having for
            anything long enough to want a real player's scrubbing and PiP. */}
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
