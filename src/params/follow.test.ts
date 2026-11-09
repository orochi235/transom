import { describe, expect, it } from 'vitest'
import { follows, nextFollow } from '@/params/follow.ts'
import { defaultParams } from '@/params.ts'
import type { WallItem } from '@shared/protocol.ts'

const item = (zone: string) => ({ id: 'x', zone }) as WallItem

describe('follows', () => {
  it('stays put when off', () => {
    expect(follows('off', 'weasel', item('weasel'))).toBe(false)
  })
  it('takes only the open stack’s arrivals on stack', () => {
    expect(follows('stack', 'weasel', item('weasel'))).toBe(true)
    expect(follows('stack', 'weasel', item('blits'))).toBe(false)
  })
  it('takes every arrival on any', () => {
    expect(follows('any', 'weasel', item('blits'))).toBe(true)
  })
})

describe('nextFollow', () => {
  it('cycles off, stack, any and back', () => {
    expect(nextFollow('off')).toBe('stack')
    expect(nextFollow('stack')).toBe('any')
    expect(nextFollow('any')).toBe('off')
  })
  it('defaults to off', () => {
    expect(defaultParams.follow).toEqual({ arrivals: 'off' })
  })
})
