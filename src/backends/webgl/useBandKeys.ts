import { useEffect } from 'react'
import { isForAControl, sortFor, togglesList } from '@/nav/keys.ts'
import type { SortKey } from '@/nav/sort.ts'

export function useBandKeys(
  setListed: (on: (was: boolean) => boolean) => void,
  setSort: (next: SortKey) => void,
  undo: () => void,
) {
  // Guarded against fields only, like the sorts: a focused band row must not
  // swallow its own key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element | null)?.closest?.('input, select, textarea, [contenteditable]')) return
      if (togglesList(e)) setListed((on) => !on)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setListed])

  // The function keys pick a sort. No control guard, unlike the wall's own
  // keys: clicking a sort leaves its button focused, and a guard would then
  // swallow the key that row is labelled with.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = sortFor(e)
      if (!key) return
      e.preventDefault()
      setSort(key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Cmd-Z is what a hand reaches for, and the wall has nothing else to undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      if (isForAControl(e.target)) return
      e.preventDefault()
      undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])
}
