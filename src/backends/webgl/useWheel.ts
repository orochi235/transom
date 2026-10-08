import { useThree } from '@react-three/fiber'
import { type Dispatch, type SetStateAction, useEffect } from 'react'
import { createGestureRail } from '@/nav/gesture.ts'
import type { StackParams } from '@/params.ts'
import { depthOf, type ViewAction } from '@/view-state.ts'
import type { Act } from '@/backends/webgl/usePick.ts'
import type { WallState } from '@/backends/webgl/useWallState.ts'

export function useWheel({
  s,
  act,
  panBy,
  params,
  onParams,
  dispatch,
}: {
  s: WallState
  act: Act
  panBy: (dx: number) => void
  params: StackParams
  onParams: Dispatch<SetStateAction<StackParams>>
  dispatch: Dispatch<ViewAction>
}) {
  const { gl } = useThree()
  const { movingRank, paramsRef, pose, viewRef, backOff, backedOffRef } = s
  // On the window rather than the canvas, so the gesture keeps working under
  // the lightbox, which covers it.
  useEffect(() => {
    const rail = createGestureRail(params.nav)
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element | null)?.closest?.('.params, .minimap, .prefs, .sidebar')) return
      // A trackpad pinch is a wheel event with ctrlKey set; left alone it zooms
      // the page instead of the wall.
      e.preventDefault()
      // Mid-drag the wheel is the third axis, not a rung. A drag reaches only
      // the two axes facing the camera, and orbiting to find the third is a
      // detour when the hand is already on the pile.
      // Scrolling with the wheel button held is the third axis: a drag reaches
      // only the two facing the camera, and orbiting to find the last one is a
      // detour when the hand is already on the pile.
      const rank = movingRank.current
      if (rank !== null) {
        const notches = e.deltaY / 100
        return void onParams((p) => ({
          ...p,
          step: { ...p.step, z: p.step.z - (notches * p.nav.dragDepthPerNotch) / Math.max(1, rank) },
        }))
      }
      // A two-finger sideways swipe slides the row. Taken before the rail so a
      // horizontal gesture never spends a rung, and only where the wall is
      // wider than the window — elsewhere deltaX is noise from a diagonal
      // scroll.
      if (paramsRef.current.camera.wallShows !== undefined && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const el = gl.domElement
        return panBy((e.deltaX * (pose.current.halfHeight * 2)) / el.clientHeight)
      }
      const step = rail.feed({ deltaY: e.deltaY, ctrlKey: e.ctrlKey }, e.timeStamp)
      if (!step) return
      // The wall has one more step out than the hierarchy: a little extra room.
      const atWall = depthOf(viewRef.current) === 0
      if (step === 'out') return atWall ? backOff.current(true) : dispatch({ type: 'out' })
      if (atWall && backedOffRef.current) return backOff.current(false)
      act.current.navigate(act.current.chainAt(e.clientX, e.clientY))
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [params.nav, dispatch, onParams])
}
