import { type Dispatch, type SetStateAction, useEffect } from 'react'
import { deletes, directionFor, isForAControl, opensIn } from '@/nav/keys.ts'
import { afterDelete, jumpFrom, pageFrom, readingOrder, streamFrom } from '@/nav/list.ts'
import { neighborOf } from '@/nav/neighbor.ts'
import { cardOf, depthOf, descend, type ViewAction, zoneOf } from '@/view-state.ts'
import type { WallState } from '@/backends/webgl/useWallState.ts'

export function useWallKeys({
  s,
  cursor,
  setCursor,
  dispatch,
  onDelete,
}: {
  s: WallState
  cursor: string | null
  setCursor: Dispatch<SetStateAction<string | null>>
  dispatch: Dispatch<ViewAction>
  onDelete: (id: string) => void
}) {
  const { viewRef, stream, flatRef, zoneById, cardsByZone, listedRef, bases, latest, cells } = s
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isForAControl(e.target)) return
      if (e.key === 'Escape') {
        // The cursor is the innermost thing showing, so it is what Escape
        // takes away first.
        if (!zoneOf(viewRef.current) && cursor) return setCursor(null)
        return dispatch({ type: 'out' })
      }
      if (opensIn(e)) {
        const newest = stream.current[0]
        const next =
          flatRef.current && depthOf(viewRef.current) === 0
            ? newest && zoneById.current.get(newest) !== undefined
              ? [zoneById.current.get(newest)!, newest]
              : null
            : descend(viewRef.current.path, cursor, (zone) => cardsByZone.current.get(zone)?.[0])
        if (!next) return
        // Space scrolls a document, and the canvas is one as far as the
        // browser is concerned.
        e.preventDefault()
        setCursor(null)
        return dispatch({ type: 'to', path: next })
      }
      const zone = zoneOf(viewRef.current)
      const card = cardOf(viewRef.current)
      const order = () => (listedRef.current ? readingOrder(bases.current) : null)
      // What the band has filtered out is still on the wall, dimmed, and still
      // opens on a click — but paging runs past it, because arrowing through
      // the very cards you just excluded is not what narrowing the band asked
      // for.
      const skip = (id: string) => latest.current.dimmed.has(id)
      if (zone && card && deletes(e)) {
        e.preventDefault()
        // Moved first, or the expiry the daemon broadcasts prunes the view off
        // the card and the lightbox closes.
        const next = flatRef.current
          ? (streamFrom(card, 'right', stream.current, zoneById.current, skip) ??
            streamFrom(card, 'left', stream.current, zoneById.current, skip))
          : afterDelete({ zone, card }, cardsByZone.current, order(), skip)
        dispatch(next ? { type: 'to', path: next } : { type: 'out' })
        onDelete(card)
        return
      }

      const direction = directionFor(e)
      if (!direction) return
      if (!zone) {
        // At the wall the arrows drive the cursor rather than the camera: the
        // first press shows it on the first cell, every press after walks it.
        e.preventDefault()
        setCursor((at) => {
          const cells_ = cells.current
          if (!at || !cells_.has(at)) return [...cells_.keys()][0] ?? null
          return neighborOf(cells_, at, direction) ?? at
        })
        return
      }

      if (card) {
        // Inside a card left and right page the pile, and shift jumps to a
        // neighboring pile's front card in any direction.
        const sideways = direction === 'left' || direction === 'right'
        const next = flatRef.current
          ? sideways
            ? streamFrom(card, direction, stream.current, zoneById.current, skip)
            : null
          : e.shiftKey
            ? jumpFrom(zone, direction, cells.current, cardsByZone.current)
            : sideways
              ? pageFrom({ zone, card }, direction, cardsByZone.current, order(), skip)
              : null
        if (next) dispatch({ type: 'to', path: next })
        return
      }

      const next = neighborOf(cells.current, zone, direction)
      if (next) dispatch({ type: 'to', path: [next] })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch, cursor, onDelete])
}
