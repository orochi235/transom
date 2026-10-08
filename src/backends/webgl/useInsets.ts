import { useEffect, useRef } from 'react'

export function useInsets(sidebarOpen: boolean) {
  // The fraction of the canvas the panel covers, measured rather than assumed:
  // its width lives in CSS, and a constant here would drift from it silently.
  // Read on toggle and on resize, never per frame — it forces a layout.
  const sidebarInset = useRef(0)
  const topInset = useRef(0)
  useEffect(() => {
    const measure = () => {
      const el = document.querySelector('.sidebar')
      const w = el?.getBoundingClientRect().width ?? 0
      sidebarInset.current = w > 0 ? w / window.innerWidth : 0
      const band = document.querySelector('.topbar')
      const h = band?.getBoundingClientRect().height ?? 0
      topInset.current = h > 0 ? h / window.innerHeight : 0
    }
    // After the panel has painted, so the element is there to measure.
    const id = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('resize', measure)
    }
  }, [sidebarOpen])
  return { sidebarInset, topInset }
}
