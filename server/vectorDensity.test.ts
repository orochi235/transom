import { describe, expect, it } from 'vitest'
import { vectorDensity } from './vectorDensity.ts'

describe('vectorDensity', () => {
  it('scales a small drawing up to the thumbnail edge', () => {
    expect(vectorDensity({ w: 64, h: 32 }, 1024)).toBe(72 * 16)
  })

  it('leaves a drawing already past the edge at its own size', () => {
    expect(vectorDensity({ w: 4000, h: 1000 }, 1024)).toBe(72)
  })

  it('caps a sliver rather than asking for a huge raster', () => {
    expect(vectorDensity({ w: 1, h: 1 }, 1024)).toBe(72 * 64)
  })

  it('falls back to sharp’s default with no size to go on', () => {
    expect(vectorDensity(null, 1024)).toBe(72)
  })
})
