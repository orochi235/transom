import type { Rect } from 'windease'

export const easeOut = (t: number) => 1 - (1 - t) ** 3

type Glide = { from: Rect; to: Rect; at: number }

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

function glideAt(glide: Glide, now: number, ms: number): Rect {
  const t = ms > 0 ? easeOut(Math.min(1, (now - glide.at) / ms)) : 1
  const { from, to } = glide
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: to.z,
    w: from.w + (to.w - from.w) * t,
    h: from.h + (to.h - from.h) * t,
  }
}

/**
 * Where each key's box stands now, on its way to the target it was last handed.
 * A new target starts from wherever the last move had got to, so a target
 * changed twice mid-flight turns rather than jumping. A key seen for the first
 * time arrives in place, or glides in from `from` when handed one. Keys absent from `keep` are forgotten, so one that
 * leaves and comes back arrives in place too, not from where it last stood.
 */
export function createGlides() {
  const glides = new Map<string, Glide>()
  return {
    at(key: string, to: Rect, now: number, ms: number, from?: Rect): Rect {
      const glide = glides.get(key)
      if (!glide) {
        glides.set(key, { from: from ?? to, to, at: now })
        return from ? glideAt(glides.get(key)!, now, ms) : to
      }
      if (!sameRect(glide.to, to)) {
        glides.set(key, { from: glideAt(glide, now, ms), to, at: now })
      }
      return glideAt(glides.get(key) ?? glide, now, ms)
    },
    keep(present: { has(key: string): boolean }) {
      for (const key of glides.keys()) if (!present.has(key)) glides.delete(key)
    },
  }
}
