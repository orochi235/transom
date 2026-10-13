import { describe, expect, it } from 'vitest'
import type { WallItem } from '@shared/protocol.ts'
import { hostOf, hostTally, keptByHost, LOCAL } from './host-filter.ts'

const item = (over: Partial<WallItem> = {}): WallItem =>
  ({ id: 'a', zone: 'z', name: 'a.png', url: '/a', path: '/a', bornAt: 0, w: 1, h: 1, ...over }) as WallItem

describe('hostOf', () => {
  it('calls a card with no host local', () => {
    expect(hostOf(item())).toBe(LOCAL)
    expect(hostOf(item({ host: 'studio' }))).toBe('studio')
  })
})

describe('keptByHost', () => {
  it('keeps everything while nothing is picked', () => {
    expect(keptByHost(item({ host: 'studio' }), new Set())).toBe(true)
  })

  it('keeps only the picked Macs once one is', () => {
    const picked = new Set(['studio'])
    expect(keptByHost(item({ host: 'studio' }), picked)).toBe(true)
    expect(keptByHost(item({ host: 'mini' }), picked)).toBe(false)
    expect(keptByHost(item(), picked)).toBe(false)
  })

  it('keeps the local cards when local is the pick', () => {
    expect(keptByHost(item(), new Set([LOCAL]))).toBe(true)
  })
})

describe('hostTally', () => {
  it('puts the local row first and the rest by name', () => {
    expect(hostTally([item({ host: 'studio' }), item(), item({ host: 'mini' }), item({ host: 'studio' })])).toEqual([
      { key: LOCAL, label: 'local', count: 1 },
      { key: 'mini', label: 'mini', count: 1 },
      { key: 'studio', label: 'studio', count: 2 },
    ])
  })

  it('is empty while every card is local', () => {
    expect(hostTally([item(), item()])).toEqual([])
    expect(hostTally([])).toEqual([])
  })

  it('has no local row on a wall with no local cards', () => {
    expect(hostTally([item({ host: 'mini' })])).toEqual([{ key: 'mini', label: 'mini', count: 1 }])
  })

  it('keeps a picked Mac at zero once its cards are gone', () => {
    expect(hostTally([item()], new Set(['studio']))).toEqual([
      { key: LOCAL, label: 'local', count: 1 },
      { key: 'studio', label: 'studio', count: 0 },
    ])
  })
})
