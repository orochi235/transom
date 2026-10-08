import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef } from 'react'
import type { StackParams } from '@/params.ts'

/** How often an idle wall still draws. Ages, fades and the age chips move on
 *  the clock with nothing to wake the canvas, and none of them reads finer. */
const IDLE_MS = 1000

export function useWake(params: StackParams) {
  const { invalidate } = useThree()
  // The canvas draws on demand. Whatever can start motion calls `wake`, which
  // keeps frames coming for as long as the longest animation it could start;
  // motion that runs longer than that keeps them coming from the frame itself.
  const holdMs = useRef(0)
  holdMs.current = Math.max(params.shoveMs, params.zoneGrid.moveMs, params.camera.moveMs) + 120
  const awakeUntil = useRef(0)
  const wake = useCallback(() => {
    awakeUntil.current = Math.max(awakeUntil.current, performance.now() + holdMs.current)
    invalidate()
  }, [invalidate])
  useEffect(() => {
    const events = ['pointermove', 'pointerdown', 'pointerup', 'wheel', 'keydown', 'resize'] as const
    for (const name of events) window.addEventListener(name, wake, { passive: true })
    return () => {
      for (const name of events) window.removeEventListener(name, wake)
    }
  }, [wake])
  useEffect(() => {
    const id = setInterval(invalidate, IDLE_MS)
    return () => clearInterval(id)
  }, [invalidate])
  return { wake, awakeUntil }
}
