/**
 * Where a lightbox image sits and how big it is drawn, as pure arithmetic over
 * two sizes and a pointer.
 *
 * `scale` is CSS pixels per image pixel, and `x`/`y` offset the image's center
 * from the viewport's center in CSS pixels. Everything else is derived, so the
 * component holds one small object and no measurements of its own.
 */
export type Size = { w: number; h: number }
export type Point = { x: number; y: number }
export type View = { scale: number; x: number; y: number }

/** How far past the image's own pixels a zoom may go. Past 1 it is magnifying
 *  what is there rather than showing more, which is still what you want for
 *  reading a screenshot's small print. */
export const MAX_SCALE = 8

/** Fraction of the viewport a fitted image fills, leaving the frame's keyline
 *  and glow somewhere to land. */
export const FIT_MARGIN = 0.94

/** e-folds of scale per pixel of wheel travel. A notch is ~100px, so one notch
 *  is about 1.2x — small enough to land on a size, large enough to cross the
 *  range in a few flicks. */
const ZOOM_PER_PX = 0.0018

/**
 * The scale at which the whole image is visible. Never above 1: blowing a small
 * artifact up to fill the window is a decision, not a default, and `max-width`
 * has never done it here.
 */
export function fitScale(image: Size, port: Size): number {
  if (image.w <= 0 || image.h <= 0) return 1
  return Math.min(1, (port.w * FIT_MARGIN) / image.w, (port.h * FIT_MARGIN) / image.h)
}

/** The fitted, centered view — what opening an artifact shows. */
export function fitView(image: Size, port: Size): View {
  return { scale: fitScale(image, port), x: 0, y: 0 }
}

/**
 * Pan held inside the viewport. An axis whose image is smaller than the window
 * is centered and cannot be dragged; an axis larger than it may travel exactly
 * far enough to bring either edge to the window's edge and no further. Letting
 * a large image drift off into the scrim is the usual sloppy-viewer failure.
 */
export function clampPan(view: View, image: Size, port: Size): View {
  const slack = (drawn: number, within: number) => Math.max(0, (drawn - within) / 2)
  const rx = slack(image.w * view.scale, port.w)
  const ry = slack(image.h * view.scale, port.h)
  return {
    scale: view.scale,
    x: Math.min(rx, Math.max(-rx, view.x)),
    y: Math.min(ry, Math.max(-ry, view.y)),
  }
}

const clampScale = (scale: number, image: Size, port: Size) =>
  Math.min(MAX_SCALE, Math.max(fitScale(image, port), scale))

/**
 * Zoom to `scale`, keeping whatever image point is under `at` under it still.
 * Anchoring on the pointer rather than the center is the whole difference
 * between aiming a zoom and chasing one.
 */
export function zoomTo(
  view: View,
  scale: number,
  at: Point,
  image: Size,
  port: Size,
): View {
  const next = clampScale(scale, image, port)
  // Where the anchored point sits relative to the image's center, in image
  // pixels — the one quantity a zoom must not change.
  const ix = (at.x - port.w / 2 - view.x) / view.scale
  const iy = (at.y - port.h / 2 - view.y) / view.scale
  return clampPan(
    { scale: next, x: at.x - port.w / 2 - ix * next, y: at.y - port.h / 2 - iy * next },
    image,
    port,
  )
}

/** A wheel or pinch notch, as a multiplier on the current scale. */
export function zoomByWheel(
  view: View,
  deltaY: number,
  at: Point,
  image: Size,
  port: Size,
): View {
  return zoomTo(view, view.scale * Math.exp(-deltaY * ZOOM_PER_PX), at, image, port)
}

/** Dragged by a pointer delta, then held inside the viewport. */
export function panBy(view: View, dx: number, dy: number, image: Size, port: Size): View {
  return clampPan({ scale: view.scale, x: view.x + dx, y: view.y + dy }, image, port)
}

/** Whether the view has been zoomed off its fitted size. Pan, the grab cursor
 *  and the zoom readout all hang on this rather than on a mode flag. */
export function isZoomed(view: View, image: Size, port: Size): boolean {
  return view.scale > fitScale(image, port) + 1e-6
}

/** Whether the image is fitted smaller than its own pixels: what a click on it
 *  enlarges, and what the cursor and the corner pill offer to. */
export function isShrunk(view: View, image: Size, port: Size): boolean {
  return !isZoomed(view, image, port) && fitScale(image, port) < 1 - 1e-6
}

/**
 * What a click on the picture alternates between: fitted, or the image's own
 * pixels. From fit it goes to 1:1, and from anywhere else back to fit — so a
 * second click always returns you, whatever the wheel did in between.
 */
export function toggleScale(view: View, image: Size, port: Size): number {
  return isZoomed(view, image, port) ? fitScale(image, port) : 1
}

/**
 * How little of the window a fitted image may use across its short axis before
 * fitting stops being a way of seeing it. A 4800x600 panorama fitted to a
 * 1600x1000 window stands 188px tall: every pixel is on screen and nothing in
 * it can be read.
 */
export const SLIVER = 0.4

/**
 * The scale at which the image covers the window — its short axis filled, its
 * long one running off to be panned. Never above 1, for the reason `fitScale`
 * is never above 1.
 */
export function fillScale(image: Size, port: Size): number {
  if (image.w <= 0 || image.h <= 0) return 1
  return Math.min(1, Math.max((port.w * FIT_MARGIN) / image.w, (port.h * FIT_MARGIN) / image.h))
}

/**
 * Whether this image is so much longer than it is deep that fitting it wastes
 * the window. Measured against what fitting would actually draw rather than
 * against a ratio of the image alone, because the same picture is a panorama
 * on one monitor and an ordinary wide image on another.
 */
export function isPanorama(image: Size, port: Size, sliver = SLIVER): boolean {
  if (image.w <= 0 || image.h <= 0) return false
  const scale = fitScale(image, port)
  return Math.min((image.w * scale) / port.w, (image.h * scale) / port.h) < sliver
}

/**
 * What a panorama's own toggle alternates between: the whole thing at once, or
 * enough of it to read. Distinct from `toggleScale`, which trades fit against
 * the image's own pixels — for a panorama those are often the same number, so
 * the click would appear to do nothing.
 */
export function togglePanorama(view: View, image: Size, port: Size): number {
  const filled = fillScale(image, port)
  return view.scale >= filled - 1e-6 ? fitScale(image, port) : filled
}

/** One axis of the window's place within the drawn image: how much of it is on
 *  screen and where that window starts, both as fractions of the whole. */
export type Bar = { size: number; at: number }

/**
 * Where the window sits within the image, per axis, for the bars that say how
 * much is off screen. Null on an axis that fits, which has nothing to say.
 *
 * Drawn rather than native scrollbars because the image is placed by a
 * transform, not by a scroll offset: a real scroll container would have to own
 * the pan, and the zoom's pointer anchoring is written against the transform.
 */
export function barsOf(
  view: View,
  image: Size,
  port: Size,
): { x: Bar | null; y: Bar | null } {
  const axis = (drawn: number, within: number, offset: number): Bar | null => {
    if (drawn <= within + 1e-6) return null
    return { size: within / drawn, at: (drawn / 2 - offset - within / 2) / drawn }
  }
  return {
    x: axis(image.w * view.scale, port.w, view.x),
    y: axis(image.h * view.scale, port.h, view.y),
  }
}

/** Where the image is drawn under a view, in viewport pixels: its top-left
 *  corner and its drawn size. */
export function boxOf(view: View, image: Size, port: Size): { x: number; y: number; w: number; h: number } {
  const w = image.w * view.scale
  const h = image.h * view.scale
  return { x: port.w / 2 + view.x - w / 2, y: port.h / 2 + view.y - h / 2, w, h }
}

/** Room the drawing bar takes at the foot of the window, below the meta line's
 *  own margin: the picture is fitted above it so no mark lands under a button. */
export const MARKING_BAR_PX = 120

/** The view a drawing is made in: fitted, and lifted clear of the bar. */
export function markingView(image: Size, port: Size): View {
  const scale = fitScale(image, { w: port.w, h: Math.max(1, port.h - MARKING_BAR_PX) })
  return { scale, x: 0, y: -MARKING_BAR_PX / 2 + 24 }
}
