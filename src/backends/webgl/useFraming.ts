import { useEffect } from 'react'
import { containerFor, frontSlotOf, gridCells } from '@/arrangements/zones.ts'
import { frameExtent, framePose } from '@/camera/frame.ts'
import { clampPan, revealPan } from '@/camera/pan.ts'
import { unionOf, withHeadroom } from '@/nav/zone-cells.ts'
import type { StackParams } from '@/params.ts'
import type { WallState } from '@/backends/webgl/useWallState.ts'
import type { useBounds } from '@/backends/webgl/useBounds.ts'

/** The framing slack for a rung, the last entry serving every rung past it. */
const marginFor = (margins: readonly number[], depth: number) =>
  margins[Math.min(depth, margins.length - 1)] ?? 1

export function useFraming({
  s,
  bounds,
  params,
  backedOff,
  sidebarInset,
  topInset,
  cursor,
  wake,
}: {
  s: WallState
  bounds: ReturnType<typeof useBounds>['bounds']
  params: StackParams
  backedOff: boolean
  sidebarInset: { current: number }
  topInset: { current: number }
  cursor: string | null
  wake: () => void
}) {
  const { zoneNamesRef, flatRef, streamBox, bases, panX, move, pose, paramsRef } = s
  // The arrows move the cursor across a row that may be wider than the window,
  // so the row follows it rather than the cursor walking off the edge.
  useEffect(() => {
    if (params.camera.wallShows === undefined || cursor === null) return
    const cell = bases.current.get(cursor)
    const box = unionOf([...bases.current.values()])
    if (!cell || !box) return
    const halfWidth = pose.current.halfHeight * (window.innerWidth / window.innerHeight)
    panX.current = revealPan(panX.current, cell, box, halfWidth)
    wake()
  }, [cursor, params.camera.wallShows, wake])

  // Retargeted every frame rather than only on a level change: the cells are
  // not known until the first layout runs, and zones arrive and leave under a
  // camera that is already parked. A new move only starts when the target has
  // actually moved, so a steady wall is not re-eased every frame.
  const retarget = (depth: number, zone: string | null) => {
    const aspect = window.innerWidth / window.innerHeight
    // The front card of each pile, not the union of everything it draws. A
    // pile's deep ranks step past its cell and are allowed to run off the
    // screen behind it: framing them pulls the camera back until the fronts —
    // the only rank anyone reads — are small.
    // The room a spare cell reserves is framed as though a pile stood in it, or
    // the camera would pull straight back into the one occupied quarter and
    // `minCells` would change nothing you can see. Only while zones are short
    // of it: once there are enough, every cell is claimed and the fronts are
    // the whole grid already.
    const container = containerFor(zoneNamesRef.current.length, aspect, params.zoneGrid)
    const zones = zoneNamesRef.current
    const spare =
      !flatRef.current && zones.length < params.zoneGrid.minCells
        ? gridCells(params.zoneGrid.minCells, container, params.zoneGrid)
            .slice(zones.length)
            .map((cell) => frontSlotOf(cell, params))
        : []
    const wall = (flatRef.current ? streamBox.current : unionOf([...bases.current.values(), ...spare])) ?? {
      x: 0,
      y: 0,
      z: 0,
      w: aspect,
      h: 1,
    }
    const framed = !zone ? wall : (bases.current.get(zone) ?? wall)
    // A label hangs above its cell, so framing the cells alone crops it.
    const headroom =
      (params.zones.labels ? params.zones.labelSize * 1.6 : 0) + params.attention.badgeSize
    const box = withHeadroom(framed, headroom)
    const frameAt = (margin: number) =>
      framePose(box, {
        projection: params.camera.projection,
        fovDeg: params.camera.fovDeg,
        standoff: params.camera.standoff,
        aspect,
        margin,
        insetRight: sidebarInset.current,
        insetTop: topInset.current,
        // Only the wall rung holds a set width; every rung below frames one
        // cell, which is the thing being looked at rather than a view of many.
        showWidth: depth === 0 ? params.camera.wallShows : undefined,
      })
    const wallMargin = marginFor(params.camera.margins, 0)
    const target = frameAt(
      marginFor(params.camera.margins, depth) * (depth === 0 && backedOff ? params.camera.zoomOutRoom : 1),
    )
    if (depth === 0 && params.camera.wallShows !== undefined) {
      const held = clampPan(panX.current, box.w, target.halfHeight * aspect)
      panX.current = held
      target.x += held
    }
    if (depth === 0) {
      bounds.current = {
        outer: frameExtent(frameAt(wallMargin * params.camera.zoomOutRoom), aspect),
        inner: frameExtent(frameAt(wallMargin), aspect),
      }
    }

    const held = move.current?.to
    const moved =
      !held ||
      Math.abs(held.x - target.x) > 1e-3 ||
      Math.abs(held.y - target.y) > 1e-3 ||
      Math.abs(held.distance - target.distance) > 1e-3 ||
      Math.abs(held.halfHeight - target.halfHeight) > 1e-3
    if (!moved) return

    move.current = {
      from: { ...pose.current },
      to: target,
      startedAt: performance.now(),
      durationMs: params.camera.moveMs,
    }
  }

  const panBy = (dx: number) => {
    if (paramsRef.current.camera.wallShows === undefined) return
    panX.current += dx
    // `retarget` runs inside the frame loop and reads the ref, so waking the
    // loop is the whole of applying a pan.
    wake()
  }

  return { retarget, panBy }
}
