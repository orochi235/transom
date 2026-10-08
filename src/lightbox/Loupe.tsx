import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import {
  TrialLoupe,
  createCanvasSource,
  type CanvasSource,
  type LoupeRenderArgs,
} from '@weasel-js/labkit/loupe'
import type { Box } from '@/lightbox/Markup.tsx'
import type { Size } from '@/lightbox/view.ts'
import '@/lightbox/loupe.css'

/** `pixels` enlarges each pixel into a block, `smooth` interpolates between
 *  them, and `vector` redraws an SVG at the lens's scale, which has no pixels
 *  to choose between. */
export type LensMode = 'pixels' | 'smooth' | 'vector'

/** Whether a picture is drawn rather than stored as pixels, by its URL —
 *  `/orig` names every original with its own extension. */
export const isVector = (url: string): boolean => /\.svg$/i.test(url)

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
  natural,
  mode,
  onShown,
  onColor,
}: {
  img: RefObject<HTMLImageElement | null>
  /** The element the lens tracks the pointer across, with `box` in its pixels. */
  host: RefObject<HTMLElement | null>
  box: Box
  /** The picture's own size. Not the element's: Chrome reports an SVG with
   *  only a viewBox as 300×150, whatever shape it is. */
  natural: Size
  mode: LensMode
  onShown: (shown: boolean) => void
  onColor: (hex: string) => void
}) {
  const boxRef = useRef(box)
  boxRef.current = box
  const naturalRef = useRef(natural)
  naturalRef.current = natural
  const held = useRef<{ src: string; canvas: HTMLCanvasElement; source: CanvasSource } | null>(null)

  const source = useMemo(
    () => () => {
      const el = img.current
      const { w, h } = naturalRef.current
      if (!el?.complete || !w || !h) return null
      if (held.current?.src === el.currentSrc) return held.current.source
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')?.drawImage(el, 0, 0, w, h)
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
        mode === 'pixels'
          ? undefined
          : (args) => (
              <DrawnLens
                args={args}
                picture={() => (mode === 'vector' ? img.current : (held.current?.canvas ?? null))}
                box={box}
              />
            )
      }
      onLens={(lens) => onShown(lens !== null)}
      onColorChange={onColor}
    />
  )
}

/**
 * The lens's stage with the picture drawn through the magnified camera, at
 * the screen's own density: the held canvas resampled, or an SVG element,
 * which Chrome rasterizes afresh at the size it is drawn. labkit's pixel lens
 * turns smoothing off and has no switch for it, so these draw their own.
 */
function DrawnLens({
  args,
  picture,
  box,
}: {
  args: LoupeRenderArgs
  picture: () => CanvasImageSource | null
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
