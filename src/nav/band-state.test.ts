import { describe, expect, it, vi } from 'vitest'
import { type BandState, DEFAULT_BAND, loadBand, readBand, saveBand } from '@/nav/band-state.ts'

const fake = (): Storage => {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage
}

/**
 * A value per field, none of them the default. Typed against `BandState`, so a
 * control added to the band without a sample here fails to compile — which is
 * what makes the round-trip below a standing check rather than a snapshot of
 * the fields that happened to exist the day it was written.
 */
const SAMPLE: { [K in keyof BandState]-?: BandState[K] } = {
  sort: 'recency',
  kinds: ['video'],
  range: { fromAgo: 3_600_000, toAgo: 0 },
  hosts: ['', 'studio'],
  arrangement: 'inbox',
  listed: true,
}

describe('every field the band holds', () => {
  it('differs from its default, or the round trip below proves nothing', () => {
    for (const key of Object.keys(SAMPLE) as (keyof BandState)[]) {
      expect(SAMPLE[key]).not.toEqual(DEFAULT_BAND[key])
    }
  })

  it('survives a save and a load', () => {
    const storage = fake()
    saveBand(SAMPLE, storage)
    expect(loadBand(storage)).toEqual(SAMPLE)
  })
})

describe('readBand', () => {
  it('is the defaults when nothing is stored', () => {
    expect(loadBand(fake())).toEqual(DEFAULT_BAND)
  })

  it('drops one unreadable field rather than the whole band', () => {
    const out = readBand({ ...SAMPLE, sort: 'loudest' })
    expect(out.sort).toBe(DEFAULT_BAND.sort)
    expect(out.listed).toBe(true)
  })

  it('drops a kind this build no longer has', () => {
    expect(readBand({ kinds: ['video', 'hologram'] }).kinds).toEqual(['video'])
  })

  it('drops a host that is not a name', () => {
    expect(readBand({ hosts: ['studio', 7, null] }).hosts).toEqual(['studio'])
  })

  it('refuses a range whose thumbs are the wrong way round', () => {
    expect(readBand({ range: { fromAgo: 0, toAgo: 60_000 } }).range).toBeNull()
  })

  it('keeps a null range, which is the band set to no filter at all', () => {
    expect(readBand({ ...SAMPLE, range: null }).range).toBeNull()
  })

  it('ignores a stored blob that is not an object', () => {
    expect(readBand(null)).toEqual(DEFAULT_BAND)
    expect(readBand([1, 2])).toEqual(DEFAULT_BAND)
  })
})

describe('storage that will not play along', () => {
  it('loads the defaults rather than throwing, as a private window does', () => {
    const hostile = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: vi.fn(),
    }
    expect(loadBand(hostile as unknown as Storage)).toEqual(DEFAULT_BAND)
  })

  it('swallows a refused write', () => {
    expect(() =>
      saveBand(DEFAULT_BAND, {
        setItem: () => {
          throw new Error('quota')
        },
      } as unknown as Storage),
    ).not.toThrow()
  })

  it('is the defaults when the stored text is not JSON', () => {
    const storage = fake()
    storage.setItem('transom.band.v1', '{oops')
    expect(loadBand(storage)).toEqual(DEFAULT_BAND)
  })
})

describe('the standalone keys this object replaced', () => {
  it('carries the list flag over', () => {
    const storage = fake()
    storage.setItem('transom.list.v1', '1')
    expect(loadBand(storage).listed).toBe(true)
  })

  it('retires the old key and writes through, so the migration runs once', () => {
    const storage = fake()
    storage.setItem('transom.list.v1', '1')
    loadBand(storage)
    expect(storage.getItem('transom.list.v1')).toBeNull()
    expect(storage.getItem('transom.band.v1')).not.toBeNull()
  })
})
