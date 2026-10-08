import { useEffect, useMemo, useRef } from 'react'
import type * as THREE from 'three'
import { boxPositions, createLoop, loopPositions, setResolution } from '@/backends/fatLines.ts'
import { CHROME_ORDER } from '@/backends/order.ts'
import type { frameExtent } from '@/camera/frame.ts'

export function useBounds() {
  /** What the bounds overlay draws, in world space: the widest frame the camera
   *  can reach and the default one. Written by `retarget` at the wall rung. */
  const bounds = useRef<{ outer: ReturnType<typeof frameExtent>; inner: ReturnType<typeof frameExtent> } | null>(null)
  const boundsLines = useMemo(() => {
    const outer = createLoop()
    const inner = createLoop()
    for (const line of [outer, inner]) {
      line.material.depthTest = false
      line.material.depthWrite = false
      line.renderOrder = CHROME_ORDER
      line.material.linewidth = 1.5
    }
    outer.material.color.set(0xff40ff)
    inner.material.color.set(0x40ffff)
    return { outer, inner }
  }, [])
  useEffect(
    () => () => {
      for (const line of [boundsLines.outer, boundsLines.inner]) {
        line.geometry.dispose()
        line.material.dispose()
      }
    },
    [boundsLines],
  )

  const draw = (showBounds: boolean, meshes: { current: Map<string, THREE.Mesh> }, gl: THREE.WebGLRenderer) => {
    const extent = showBounds ? bounds.current : null
    boundsLines.outer.visible = boundsLines.inner.visible = extent !== null
    if (extent) {
      // Through the scene's depth, from the deepest card to the frontmost.
      let z0 = 0
      let z1 = 0
      for (const mesh of meshes.current.values()) {
        if (!mesh.visible) continue
        z0 = Math.min(z0, mesh.position.z)
        z1 = Math.max(z1, mesh.position.z)
      }
      const { outer, inner } = extent
      boundsLines.outer.geometry.setPositions(boxPositions(outer.x0, outer.y0, z0, outer.x1, outer.y1, z1))
      boundsLines.outer.geometry.instanceCount = 12
      boundsLines.inner.geometry.setPositions(loopPositions(inner.x0, inner.y0, inner.x1, inner.y1, 0))
      boundsLines.inner.geometry.instanceCount = 4
      setResolution(boundsLines.outer.material, gl)
      setResolution(boundsLines.inner.material, gl)
    }
  }

  return { bounds, boundsLines, draw }
}
