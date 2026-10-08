import { useThree } from '@react-three/fiber'
import { type Dispatch, type SetStateAction, useEffect } from 'react'
import type { MenuAt } from '@/menu/CardMenu.tsx'
import { targetOf } from '@/menu/items.ts'
import { stepFromDrag } from '@/nav/step-drag.ts'
import type { StackParams } from '@/params.ts'
import { depthOf, type ViewAction } from '@/view-state.ts'
import { clamp } from '@/backends/webgl/constants.ts'
import type { Act } from '@/backends/webgl/usePick.ts'
import type { WallState } from '@/backends/webgl/useWallState.ts'

/** How far the scene turns per pixel dragged. */
const DEG_PER_PX = 0.25

/** Movement past this is an orbit; anything less is the click it looks like. */
const DRAG_SLOP_PX = 4

/** `PointerEvent.button` for the wheel pressed as a button. */
const MIDDLE_BUTTON = 1

/** How long a click on a zone's own cell waits to see whether a second one is
 *  coming. Only a bare cell waits: a card opens on the first click, and paying
 *  this on every card would be felt on every artifact on the wall. */
const DOUBLE_MS = 250

export function usePointer({
  s,
  act,
  panBy,
  onParams,
  onMenu,
  dispatch,
}: {
  s: WallState
  act: Act
  panBy: (dx: number) => void
  onParams: Dispatch<SetStateAction<StackParams>>
  onMenu: (at: MenuAt) => void
  dispatch: Dispatch<ViewAction>
}) {
  const { gl } = useThree()
  const { dragged, hovered, movingRank, stepDrag, pose, paramsRef, viewRef, pendingZone } = s
  // Bound to the canvas, not to a mesh, so the empty space between piles turns
  // the scene. A press that never travels is a click, and picks a rung.
  useEffect(() => {
    const el = gl.domElement
    let active = false
    let last = { x: 0, y: 0 }
    /** The card being dragged, and where the drag began. Null while the
     *  gesture is an orbit. Mirrored into a ref so the wheel listener, which
     *  is bound elsewhere, can tell a depth nudge from a rung of navigation. */
    let moving: { rank: number; from: { x: number; y: number } } | null = null
    const setMoving = (next: typeof moving) => {
      moving = next
      movingRank.current = next?.rank ?? null
    }

    const onDown = (e: PointerEvent) => {
      // The wheel button moves a pile; the left button turns the wall and
      // picks. Two buttons rather than a modifier, so neither gesture has to
      // be held down wrong to find out which one it was.
      const wheelDown = e.button === MIDDLE_BUTTON
      if (e.button !== 0 && !wheelDown) return
      if (wheelDown) {
        // Suppresses the platform's own middle-click behavior — autoscroll on
        // Windows, paste on X11 — which would otherwise fire under the drag.
        e.preventDefault()
        if (!stepDrag.current) return
        const rank = act.current.rankAt(e.clientX, e.clientY)
        if (rank === null) return
        setMoving({ rank, from: { x: e.clientX, y: e.clientY } })
      }
      active = true
      dragged.current = false
      last = { x: e.clientX, y: e.clientY }
      el.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (!active) {
        // Every card is a control, so it says so under the pointer.
        // Only while idle: mid-orbit the cursor belongs to the drag.
        const over = act.current.hoverAt(e.clientX, e.clientY)
        hovered.current = over
        el.classList.toggle('scene--pointing', over !== null)
        return
      }
      const dx = e.clientX - last.x
      const dy = e.clientY - last.y
      if (!dragged.current && Math.hypot(dx, dy) < DRAG_SLOP_PX) return
      dragged.current = true
      last = { x: e.clientX, y: e.clientY }
      if (moving) {
        el.classList.add('scene--moving')
        // Against the drag's own origin rather than the last frame, so the
        // pile tracks the hand exactly instead of accumulating rounding.
        const dxTotal = e.clientX - moving.from.x
        const dyTotal = e.clientY - moving.from.y
        moving.from = { x: e.clientX, y: e.clientY }
        // The camera sees `2 * halfHeight` of world over the canvas's height,
        // whichever projection it is using.
        const worldPerPx = (pose.current.halfHeight * 2) / el.clientHeight
        onParams((p) => ({
          ...p,
          step: stepFromDrag({
            base: p.step,
            dxPx: dxTotal,
            dyPx: dyTotal,
            rank: moving!.rank,
            worldPerPx,
            yawDeg: p.camera.yawDeg,
            pitchDeg: p.camera.pitchDeg,
          }),
        }))
        return
      }
      // With the orbit off the same drag slides the row instead, which is the
      // only way left to reach a zone that is off the side.
      if (!paramsRef.current.nav.orbit) {
        if (paramsRef.current.camera.wallShows === undefined) return
        el.classList.add('scene--moving')
        panBy((-dx * (pose.current.halfHeight * 2)) / el.clientHeight)
        return
      }
      el.classList.add('scene--turning')
      onParams((p) => ({
        ...p,
        camera: {
          ...p.camera,
          // The camera orbits opposite the drag, so the scene follows the hand.
          yawDeg: clamp(p.camera.yawDeg - dx * DEG_PER_PX, -90, 90),
          pitchDeg: clamp(p.camera.pitchDeg + dy * DEG_PER_PX, -90, 90),
        },
      }))
    }
    const onUp = (e: PointerEvent) => {
      const turned = dragged.current
      const moved = moving !== null
      active = false
      setMoving(null)
      el.classList.remove('scene--turning')
      el.classList.remove('scene--moving')
      const over = act.current.hoverAt(e.clientX, e.clientY)
      hovered.current = over
      el.classList.toggle('scene--pointing', over !== null)
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (turned || moved || e.button !== 0) return
      const chain = act.current.chainAt(e.clientX, e.clientY)
      // At the wall a click opens the zone's top card outright, with no wait:
      // the pile it would otherwise step to is what the eye has already read.
      // Shift is the way back to a rung — and to the double-click below it.
      if (!e.shiftKey && depthOf(viewRef.current) === 0) {
        const target = act.current.clickAt(chain)
        return void (target && dispatch({ type: 'to', path: target }))
      }
      // One rung is a zone's own cell with no card under the pointer — the
      // backdrop. That is the one target that can be double-clicked, so it is
      // the one that waits.
      if (chain.length !== 1) return act.current.navigate(chain)
      if (pendingZone.current !== null) {
        window.clearTimeout(pendingZone.current)
        pendingZone.current = null
        return act.current.onPrefs()
      }
      pendingZone.current = window.setTimeout(() => {
        pendingZone.current = null
        act.current.navigate(chain)
      }, DOUBLE_MS)
    }

    // Chrome starts autoscroll from mousedown, not pointerdown, so the
    // suppression has to be on both.
    const onAux = (e: MouseEvent) => {
      if (e.button === MIDDLE_BUTTON) e.preventDefault()
    }
    // Only over the canvas: the lightbox is a real <img> so that the browser's
    // own menu can save and copy it, and taking that away would cost more than
    // the menu adds.
    const onContext = (e: MouseEvent) => {
      e.preventDefault()
      const chain = act.current.chainAt(e.clientX, e.clientY)
      onMenu({ target: targetOf(chain), x: e.clientX, y: e.clientY })
    }
    el.addEventListener('contextmenu', onContext)
    el.addEventListener('mousedown', onAux)
    el.addEventListener('auxclick', onAux)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    return () => {
      el.removeEventListener('contextmenu', onContext)
      el.removeEventListener('mousedown', onAux)
      el.removeEventListener('auxclick', onAux)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      if (pendingZone.current !== null) window.clearTimeout(pendingZone.current)
    }
  }, [gl, onParams, onMenu])
}
