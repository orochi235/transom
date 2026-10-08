import { useMemo, useRef, type RefObject } from 'react'
import { TrialLoupe, createCanvasSource, type CanvasSource } from '@weasel-js/labkit/loupe'
import type { Box } from '@/lightbox/Markup.tsx'
import '@/lightbox/loupe.css'

/**
 * A pixel lens over the lightbox's picture, shown while Alt is held.
 *
 * It reads a canvas holding the picture at its natural size, laid over the
 * picture's on-screen box, so a fitted render magnifies into its real pixels
 * rather than the downscaled ones on screen. The canvas is made the first
 * time the lens reads it: most pictures are opened and never peeked at.
 */
export function ImageLoupe({
  img,
  host,
  box,
  onShown,
  onColor,
}: {
  img: RefObject<HTMLImageElement | null>
  /** The element the lens tracks the pointer across, with `box` in its pixels. */
  host: RefObject<HTMLElement | null>
  box: Box
  onShown: (shown: boolean) => void
  onColor: (hex: string) => void
}) {
  const boxRef = useRef(box)
  boxRef.current = box
  const held = useRef<{ src: string; source: CanvasSource } | null>(null)

  const source = useMemo(
    () => () => {
      const el = img.current
      if (!el?.complete || !el.naturalWidth) return null
      if (held.current?.src === el.currentSrc) return held.current.source
      const canvas = document.createElement('canvas')
      canvas.width = el.naturalWidth
      canvas.height = el.naturalHeight
      canvas.getContext('2d')?.drawImage(el, 0, 0)
      const source = createCanvasSource(canvas, {
        box: () => {
          const b = boxRef.current
          return { x: b.x, y: b.y, width: b.w, height: b.h }
        },
      })
      held.current = { src: el.currentSrc, source }
      return source
    },
    [img],
  )

  return (
    <TrialLoupe
      enabled={false}
      hostRef={host}
      source={source}
      onLens={(lens) => onShown(lens !== null)}
      onColorChange={onColor}
    />
  )
}
