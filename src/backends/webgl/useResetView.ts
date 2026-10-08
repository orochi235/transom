import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef } from 'react'
import { homeCamera } from '@/camera/home.ts'
import type { StackParams } from '@/params.ts'
import type { ViewAction } from '@/view-state.ts'

export function useResetView(
  props: { params: StackParams; onParams: Dispatch<SetStateAction<StackParams>> },
  dispatch: Dispatch<ViewAction>,
  setBackedOff: (on: boolean) => void,
) {
  // The angle eases home over the same time a rung change takes, since the
  // framing is already doing so; snapping the orbit under a gliding frame reads
  // as a jump.
  const turning = useRef(0)
  useEffect(() => () => cancelAnimationFrame(turning.current), [])
  const onParams = props.onParams
  const cameraNow = useRef(props.params.camera)
  cameraNow.current = props.params.camera
  const resetView = useCallback(() => {
    dispatch({ type: 'to', path: [] })
    setBackedOff(false)
    cancelAnimationFrame(turning.current)
    const from = { yaw: cameraNow.current.yawDeg, pitch: cameraNow.current.pitchDeg }
    const start = performance.now()
    const tick = (t: number) => {
      const ms = cameraNow.current.moveMs
      const k = ms > 0 ? Math.min(1, Math.max(0, (t - start) / ms)) : 1
      const eased = 1 - (1 - k) ** 3
      onParams((p) => ({
        ...p,
        camera: { ...homeCamera(p.camera), yawDeg: from.yaw * (1 - eased), pitchDeg: from.pitch * (1 - eased) },
      }))
      if (k < 1) turning.current = requestAnimationFrame(tick)
    }
    turning.current = requestAnimationFrame(tick)
  }, [onParams])
  return resetView
}
