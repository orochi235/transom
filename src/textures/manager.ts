import type { Edge } from '@/textures/ratchet.ts'
import { ratchet } from '@/textures/ratchet.ts'
import { createTextureStore } from '@/textures/store.ts'

export type TextureManager<T> = {
  /** Reconcile against what this frame wants: `id → LOD edge`. */
  sync(want: ReadonlyMap<string, number>): void
  textureFor(id: string): T | undefined
  clear(): void
}

/**
 * Holds one texture per visible item at the edge its rank earned. `load` is
 * injected rather than imported so this runs with no GL context and no browser.
 */
export function createTextureManager<T>(opts: {
  budgetBytes: number
  urlFor: (id: string) => string
  load: (url: string, edge: number) => Promise<{ value: T; bytes: number } | null>
  dispose: (value: T) => void
  /** A texture has landed. A canvas that draws on demand has nothing else to
   *  tell it the card can now be drawn with its picture. */
  onLoad?: () => void
}): TextureManager<T> {
  const store = createTextureStore<T>({ budgetBytes: opts.budgetBytes, dispose: opts.dispose })
  const heldEdge = new Map<string, Edge>()
  // The URL each held texture came from. A mended card keeps its id and moves
  // to a new URL, and its old picture stays up until the new one lands.
  const heldUrl = new Map<string, string>()
  const inFlight = new Set<string>()

  return {
    sync(want) {
      for (const id of [...heldEdge.keys()]) {
        if (want.has(id)) continue
        store.delete(id)
        heldEdge.delete(id)
        heldUrl.delete(id)
      }

      for (const [id, requested] of want) {
        const url = opts.urlFor(id)
        const stale = heldUrl.has(id) && heldUrl.get(id) !== url
        const next = stale ? (requested as Edge) : ratchet(heldEdge.get(id), requested as Edge)
        if (next === 0) continue
        if (!stale && heldEdge.get(id) === next && store.get(id) !== undefined) continue
        if (inFlight.has(id)) continue

        inFlight.add(id)
        void opts.load(url, next).then((loaded) => {
          inFlight.delete(id)
          if (!loaded) return
          store.put(id, loaded.value, loaded.bytes)
          heldEdge.set(id, next)
          heldUrl.set(id, url)
          opts.onLoad?.()
        })
      }
    },
    textureFor: (id) => store.get(id),
    clear() {
      store.clear()
      heldEdge.clear()
      heldUrl.clear()
      inFlight.clear()
    },
  }
}
