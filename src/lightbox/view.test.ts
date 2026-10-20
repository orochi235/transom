import { describe, expect, it } from 'vitest'
import {
  barsOf,
  boxOf,
  clampPan,
  fillScale,
  fitScale,
  fitView,
  isPanorama,
  isShrunk,
  isZoomed,
  MAX_SCALE,
  panBy,
  toggleScale,
  togglePanorama,
  zoomTo,
} from '@/lightbox/view.ts'

const port = { w: 1000, h: 800 }
/** Larger than the viewport on both axes, so it fits below 1:1. */
const big = { w: 4000, h: 3000 }
/** Smaller than the viewport on both axes. */
const small = { w: 200, h: 100 }

describe('fitScale', () => {
  it('fits the tighter axis', () => {
    // Width binds: 1000 * 0.94 / 4000 is smaller than 800 * 0.94 / 3000.
    expect(fitScale(big, port)).toBeCloseTo((1000 * 0.94) / 4000)
  })

  it('never blows a small artifact up to fill the window', () => {
    expect(fitScale(small, port)).toBe(1)
  })

  it('survives an image measured before it loaded', () => {
    expect(fitScale({ w: 0, h: 0 }, port)).toBe(1)
  })
})

describe('clampPan', () => {
  it('centers an axis the image does not fill, however hard it is dragged', () => {
    const held = clampPan({ scale: 1, x: 400, y: -300 }, small, port)
    expect(held.scale).toBe(1)
    // Clamping a negative into a zero-width range yields -0, which is 0 to
    // everything downstream and to `toBeCloseTo`, but not to `toEqual`.
    expect(held.x).toBeCloseTo(0)
    expect(held.y).toBeCloseTo(0)
  })

  it('lets an oversized axis travel exactly to its own edge', () => {
    // At 1:1 a 4000px image in a 1000px window has 1500px of slack each way.
    expect(clampPan({ scale: 1, x: 9999, y: 0 }, big, port).x).toBe(1500)
    expect(clampPan({ scale: 1, x: -9999, y: 0 }, big, port).x).toBe(-1500)
  })

  it('leaves a pan that is already inside alone', () => {
    expect(clampPan({ scale: 1, x: 200, y: -100 }, big, port)).toEqual({
      scale: 1,
      x: 200,
      y: -100,
    })
  })
})

describe('zoomTo', () => {
  it('holds the image point under the pointer still', () => {
    const at = { x: 250, y: 200 }
    const before = fitView(big, port)
    // The image pixel under the pointer, before and after.
    const pixel = (v: typeof before) => ({
      x: (at.x - port.w / 2 - v.x) / v.scale,
      y: (at.y - port.h / 2 - v.y) / v.scale,
    })
    const was = pixel(before)
    const now = pixel(zoomTo(before, 0.5, at, big, port))
    expect(now.x).toBeCloseTo(was.x, 6)
    expect(now.y).toBeCloseTo(was.y, 6)
  })

  it('will not zoom out past the fitted size', () => {
    const out = zoomTo(fitView(big, port), 0.001, { x: 500, y: 400 }, big, port)
    expect(out.scale).toBeCloseTo(fitScale(big, port))
    // And having nothing to pan, it recentres rather than keeping an offset.
    expect(out).toMatchObject({ x: 0, y: 0 })
  })

  it('stops at the ceiling', () => {
    expect(zoomTo(fitView(big, port), 500, { x: 500, y: 400 }, big, port).scale).toBe(MAX_SCALE)
  })

  it('holds the result inside the viewport', () => {
    // A zoom anchored hard in the corner would otherwise leave the far edge
    // hanging inside the window.
    const out = zoomTo(fitView(big, port), 4, { x: 0, y: 0 }, big, port)
    expect(out).toEqual(clampPan(out, big, port))
  })
})

describe('panBy', () => {
  it('accumulates a drag and holds it inside the viewport', () => {
    const from = { scale: 1, x: 0, y: 0 }
    expect(panBy(from, 100, 50, big, port)).toEqual({ scale: 1, x: 100, y: 50 })
    expect(panBy(from, 9999, 0, big, port).x).toBe(1500)
  })
})

describe('isZoomed', () => {
  it('is false at the fitted size and true above it', () => {
    expect(isZoomed(fitView(big, port), big, port)).toBe(false)
    expect(isZoomed({ scale: 1, x: 0, y: 0 }, big, port)).toBe(true)
  })

  it('is false for a small artifact, which fits at its own pixels', () => {
    expect(isZoomed(fitView(small, port), small, port)).toBe(false)
  })
})

describe('toggleScale', () => {
  it('goes from fit to the image own pixels and back', () => {
    const fitted = fitView(big, port)
    expect(toggleScale(fitted, big, port)).toBe(1)
    expect(toggleScale({ scale: 1, x: 0, y: 0 }, big, port)).toBeCloseTo(fitScale(big, port))
  })

  it('returns to fit from any zoom, not only from 1:1', () => {
    expect(toggleScale({ scale: 3.7, x: 0, y: 0 }, big, port)).toBeCloseTo(fitScale(big, port))
  })
})

describe('panoramas', () => {
  const port = { w: 1600, h: 1000 }
  const wide = { w: 4800, h: 600 }
  const tall = { w: 600, h: 4800 }
  const ordinary = { w: 3000, h: 2000 }

  it('calls an image a panorama when fitting it leaves a sliver', () => {
    expect(isPanorama(wide, port)).toBe(true)
    expect(isPanorama(tall, port)).toBe(true)
  })

  it('leaves an ordinary image alone however large it is', () => {
    expect(isPanorama(ordinary, port)).toBe(false)
    expect(isPanorama({ w: 800, h: 600 }, port)).toBe(false)
  })

  it('fills the short axis rather than fitting the long one', () => {
    // Fit gives 0.31 here — the whole 4800px visible at 188px tall, which is
    // every pixel of it and none of it readable.
    expect(fitScale(wide, port)).toBeCloseTo(0.313, 2)
    // Fill shows it at its own height and lets the length be panned.
    expect(fillScale(wide, port)).toBeCloseTo(1, 5)
  })

  it('never magnifies to fill, the way fit never does', () => {
    expect(fillScale({ w: 200, h: 40 }, port)).toBeLessThanOrEqual(1)
  })

  it('toggles a panorama between whole and readable', () => {
    const filled = { scale: fillScale(wide, port), x: 0, y: 0 }
    expect(togglePanorama(filled, wide, port)).toBeCloseTo(fitScale(wide, port), 10)
    const fitted = { scale: fitScale(wide, port), x: 0, y: 0 }
    expect(togglePanorama(fitted, wide, port)).toBeCloseTo(fillScale(wide, port), 10)
  })
})

describe('isShrunk', () => {
  const port = { w: 1600, h: 1000 }

  it('offers full size only where fitting shrank the image', () => {
    const big = { w: 4800, h: 600 }
    expect(isShrunk(fitView(big, port), big, port)).toBe(true)
    expect(isShrunk({ scale: 1, x: 0, y: 0 }, big, port)).toBe(false)
    const small = { w: 800, h: 600 }
    expect(isShrunk(fitView(small, port), small, port)).toBe(false)
  })
})

describe('barsOf', () => {
  const image = { w: 4000, h: 2000 }
  const port = { w: 1000, h: 1000 }

  it('has nothing to say about an axis that fits', () => {
    expect(barsOf(fitView(image, port), image, port)).toEqual({ x: null, y: null })
  })

  it('sizes the bar by how much of the image is on screen', () => {
    // Drawn 4000 wide in a 1000 window: a quarter of it is visible.
    const bars = barsOf({ scale: 1, x: 0, y: 0 }, image, port)
    expect(bars.x?.size).toBeCloseTo(0.25)
    expect(bars.x?.at).toBeCloseTo(0.375)
    expect(bars.y?.size).toBeCloseTo(0.5)
  })

  it('puts the bar at either end when the pan is against its stop', () => {
    const port = { w: 1000, h: 1000 }
    const at = (x: number) => barsOf(clampPan({ scale: 1, x, y: 0 }, image, port), image, port).x?.at
    expect(at(10_000)).toBeCloseTo(0)
    expect(at(-10_000)).toBeCloseTo(0.75)
  })
})

describe('boxOf', () => {
  it('centers a fitted image in the viewport', () => {
    const view = fitView(big, port)
    const box = boxOf(view, big, port)
    expect(box.w).toBeCloseTo(big.w * view.scale)
    expect(box.x + box.w / 2).toBeCloseTo(port.w / 2)
    expect(box.y + box.h / 2).toBeCloseTo(port.h / 2)
  })
  it('moves with the pan', () => {
    expect(boxOf({ scale: 1, x: 30, y: -20 }, small, port)).toEqual({ x: 430, y: 330, w: 200, h: 100 })
  })
})
