import { KINDS, type KindKey } from '@/nav/kind-filter.ts'
import { DEFAULT_SORT, SORTS, type SortKey } from '@/nav/sort.ts'
import type { Filter } from '@/nav/time-filter.ts'

/**
 * Everything the band holds, in one object, because a control added to the
 * band and forgotten by the store is invisible until someone reloads.
 *
 * One object and one reader per field is the whole mechanism: `READERS` is
 * keyed on `keyof BandState`, so a field added here without a reader is a type
 * error rather than a control that quietly stops remembering.
 */
export type BandState = {
  sort: SortKey
  /** The kinds the wall is narrowed to; empty is every kind. An array rather
   *  than the Set the band works in, because a Set does not survive JSON. */
  kinds: readonly KindKey[]
  /** The time range, as ages rather than timestamps — a stored absolute range
   *  would name a window that has already slid off the axis by the reload. */
  range: Filter | null
  /** The Macs the wall is narrowed to, by the name their cards carry; empty is
   *  every Mac, and `LOCAL` stands for the wall's own. */
  hosts: readonly string[]
  /** Which arrangement `[` and `]` landed on, by name. An index would point at
   *  a different layout the moment the registry is reordered. */
  arrangement: string | null
  listed: boolean
}

export const DEFAULT_BAND: BandState = {
  sort: DEFAULT_SORT,
  kinds: [],
  range: null,
  hosts: [],
  arrangement: null,
  listed: false,
}

const KEY = 'transom.band.v1'

/** The standalone keys this object replaced. Read once, then removed. */
const LEGACY: { key: string; into: (raw: string) => Partial<BandState> }[] = [
  { key: 'transom.list.v1', into: (raw) => ({ listed: raw === '1' }) },
]

/** A stored field back, or undefined for anything this build cannot read —
 *  which is how a renamed sort key or a hand-edited blob loses one setting
 *  instead of the whole band. */
type Reader<K extends keyof BandState> = (raw: unknown) => BandState[K] | undefined

const isKind = (v: unknown): v is KindKey => KINDS.some((k) => k.key === v)

const READERS: { [K in keyof BandState]: Reader<K> } = {
  sort: (raw) => SORTS.find((s) => s.key === raw)?.key,
  // `run` is what a group was called in v0.2.0.
  kinds: (raw) => (Array.isArray(raw) ? raw.map((k) => (k === 'run' ? 'group' : k)).filter(isKind) : undefined),
  range: (raw) => {
    if (raw === null) return null
    if (typeof raw !== 'object') return undefined
    const { fromAgo, toAgo } = raw as Record<string, unknown>
    if (typeof fromAgo !== 'number' || typeof toAgo !== 'number') return undefined
    if (!Number.isFinite(fromAgo) || !Number.isFinite(toAgo) || fromAgo < toAgo) return undefined
    return { fromAgo, toAgo }
  },
  hosts: (raw) => (Array.isArray(raw) ? raw.filter((h): h is string => typeof h === 'string') : undefined),
  arrangement: (raw) => (raw === null || typeof raw === 'string' ? raw : undefined),
  listed: (raw) => (typeof raw === 'boolean' ? raw : undefined),
}

/** The stored blob over the defaults, field by field. */
export function readBand(stored: unknown): BandState {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return DEFAULT_BAND
  const blob = stored as Record<string, unknown>
  const out = { ...DEFAULT_BAND }
  for (const key of Object.keys(DEFAULT_BAND) as (keyof BandState)[]) {
    if (!(key in blob)) continue
    const value = READERS[key](blob[key])
    if (value !== undefined) Object.assign(out, { [key]: value })
  }
  return out
}

/** Storage throws rather than returning null in a private window, so every
 *  access is guarded: a wall that will not load is worse than one that opens
 *  unfiltered. */
export function loadBand(storage: Storage = localStorage): BandState {
  try {
    const raw = storage.getItem(KEY)
    if (raw !== null) return readBand(JSON.parse(raw))

    let carried: Partial<BandState> = {}
    for (const { key, into } of LEGACY) {
      const old = storage.getItem(key)
      if (old !== null) carried = { ...carried, ...into(old) }
      storage.removeItem(key)
    }
    const band = { ...DEFAULT_BAND, ...carried }
    // Written through at once, so a browser that never touches the band again
    // stops re-reading the keys this one replaced.
    saveBand(band, storage)
    return band
  } catch {
    return DEFAULT_BAND
  }
}

export function saveBand(band: BandState, storage: Storage = localStorage): void {
  try {
    storage.setItem(KEY, JSON.stringify(band))
  } catch {
    // A full or refused store costs the band's memory, not the band.
  }
}
