import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { StackParams } from '@/params.ts'
import { createTextureManager } from '@/textures/manager.ts'
import { loadBitmap } from '@/textures/source.ts'
import type { WallItem } from '@shared/protocol.ts'

export function useCardTextures(items: WallItem[], params: StackParams, wake: () => void) {
  const { gl } = useThree()
  // Where a card's pixels are is the daemon's answer, carried on the item —
  // not a route rebuilt here, which the demo wall has no server to satisfy.
  // Through a ref so an arrival does not rebuild the whole texture manager.
  const urlById = useRef(new Map<string, string>())
  urlById.current = useMemo(() => new Map(items.map((i) => [i.id, i.url])), [items])

  const textures = useMemo(
    () =>
      createTextureManager<THREE.Texture>({
        budgetBytes: params.lod.budgetBytes,
        urlFor: (id) => urlById.current.get(id) ?? '',
        load: async (url, edge) => {
          const bitmap = await loadBitmap(url, edge)
          if (!bitmap) return null
          const tex = new THREE.Texture(bitmap as unknown as HTMLImageElement)
          tex.colorSpace = THREE.SRGBColorSpace
          tex.needsUpdate = true
          return { value: tex, bytes: edge * edge * 4 }
        },
        dispose: (tex) => tex.dispose(),
        onLoad: wake,
      }),
    [params.lod.budgetBytes, wake],
  )

  // A lost context invalidates every GPU handle; rebuilding from an empty store
  // is the only safe response, and the manager re-uploads next frame.
  useEffect(() => {
    const canvas = gl.domElement
    const onLost = (e: Event) => {
      e.preventDefault()
      textures.clear()
    }
    canvas.addEventListener('webglcontextlost', onLost)
    return () => canvas.removeEventListener('webglcontextlost', onLost)
  }, [gl, textures])

  useEffect(() => () => textures.clear(), [textures])
  return textures
}
