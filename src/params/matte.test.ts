import { describe, expect, it } from 'vitest'
import { matteIn } from '@/params/matte.ts'
import { defaultParams } from '@/params.ts'

describe('matteIn', () => {
  it('puts the checkerboard where it is asked for, and both covers both', () => {
    expect(matteIn('both', 'stacks')).toBe(true)
    expect(matteIn('both', 'lightbox')).toBe(true)
    expect(matteIn('stacks', 'lightbox')).toBe(false)
    expect(matteIn('lightbox', 'lightbox')).toBe(true)
    expect(matteIn('off', 'stacks')).toBe(false)
  })
  it('defaults to both at 0.7', () => {
    expect(defaultParams.matte).toEqual({ where: 'both', opacity: 0.7 })
  })
})
