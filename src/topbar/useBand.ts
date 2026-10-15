import { useEffect, type RefObject } from 'react'
import { delaminate } from 'delamin8r'
import type { StackParams } from '@/params.ts'

/**
 * Everything else fixed to the top clears the band by `--band`, and the band
 * is as tall as its own type — so it publishes what it measures rather than
 * a constant that has to be re-guessed whenever the chrome is resized.
 */
export function usePublishedHeight(band: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = band.current
    if (!el) return
    const publish = () =>
      document.documentElement.style.setProperty('--band', `${el.getBoundingClientRect().height}px`)
    publish()
    const watch = new ResizeObserver(publish)
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
}

/**
 * delamin8r reads its options once, so a tuning change unwraps the band and
 * wraps it again. `window`, not `tilt`: a tilt injects a deck, and the flex
 * row would be left laying out one child.
 */
export function useBandParallax(
  band: RefObject<HTMLElement | null>,
  look: StackParams['band'],
  /** The app-wide parallax gate, over `look.parallax`. */
  allowParallax: boolean,
) {
  useEffect(() => {
    const el = band.current
    if (!el || !allowParallax || !look.parallax) return
    const handle = delaminate(el, {
      mode: 'window',
      step: look.step,
      perspective: look.perspective,
      swing: look.swing,
      // Panels, what they hold, and the rows and buttons in that. Below is the
      // slider's own machinery and the chart's bars.
      maxDepth: 3,
    })
    if (import.meta.env.DEV) {
      for (const { el: flat, cause } of handle.diagnose()) console.warn(`[band] flat: ${cause}`, flat)
    }
    return () => handle.destroy()
  }, [allowParallax, look.parallax, look.step, look.perspective, look.swing])
}
