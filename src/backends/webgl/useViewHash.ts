import { useEffect, useReducer } from 'react'
import { hashOfView, reduceView, viewFromHash, WALL } from '@/view-state.ts'

export function useViewHash() {
  const [view, dispatch] = useReducer(reduceView, WALL, () => viewFromHash(location.hash))
  // Replaced, not pushed: every wheel notch is a rung, and a history entry per
  // notch would make Back useless.
  useEffect(() => {
    const hash = hashOfView(view)
    if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname + location.search)
  }, [view])
  useEffect(() => {
    const onHash = () => dispatch({ type: 'to', path: viewFromHash(location.hash).path })
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return [view, dispatch] as const
}
