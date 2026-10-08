import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import {
  TrialLoupe,
  createCanvasSource,
  type CanvasSource,
  type LoupeRenderArgs,
} from '@weasel-js/labkit/loupe'
import type { Box } from '@/lightbox/Markup.tsx'
import '@/lightbox/loupe.css'

/**
 * A pixel lens over the lightbox's picture, shown while Alt is held.
 *
 * It reads a canvas holding the picture at its natural size, laid over the
 * picture's on-screen box, so a fitted render magnifies into its real pixels
 * rather than the downscaled ones on screen. The canvas is made the first
 * time the lens reads it: most pictures are opened and never peeked at.
 * `smooth` interpolates between those pixels instead of enlarging each one
 * into a block.
 */
export function ImageLoupe({
  img,
  host,
  box,
  smooth,
  onShown,
  onColor,
}: {
  img: RefObject<HTMLImageElement | null>
  /** The element the lens tracks the pointer across, with `box` in its pixels. */
  host: RefObject<HTMLElement | null>
  box: Box
  smooth: boolean
  onShown: (shown: boolean) => void
  onColor: (hex: string) => void
}) {
  const boxRef = useRef(box)
  boxRef.current = box
  const held = useRef<{ src: string; canvas: HTMLCanvasElement; source: CanvasSource } | null>(null)

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
      held.current = { src: el.currentSrc, canvas, source }
      return source
    },
    [img],
  )

  return (
    <TrialLoupe
      enabled={false}
      diameter={420}
      shape="square"
      hostRef={host}
      source={source}
      render={
        smooth
          ? (args) => <SmoothLens args={args} picture={() => held.current?.canvas ?? null} box={box} />
          : undefined
      }
      onLens={(lens) => onShown(lens !== null)}
      onColorChange={onColor}
    />
  )
}

/**
 * The lens's stage drawn with the picture resampled through the magnified
 * camera, at the screen's own density. labkit's pixel lens turns smoothing off
 * and has no switch for it, so the smooth lens draws its own.
 */
function SmoothLens({
  args,
  picture,
  box,
}: {
  args: LoupeRenderArgs
  picture: () => HTMLCanvasElement | null
  box: Box
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const { view, size } = args
  useLayoutEffect(() => {
    const el = canvas.current
    const from = picture()
    const ctx = el?.getContext('2d')
    if (!el || !ctx || !from) return
    const dpr = window.devicePixelRatio || 1
    el.width = Math.round(size.width * dpr)
    el.height = Math.round(size.height * dpr)
    ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.pan.x, dpr * view.pan.y)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(from, box.x, box.y, box.w, box.h)
  })
  return <canvas ref={canvas} className="lightbox__smoothLens" width={0} height={0} />
}
