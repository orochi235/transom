import type { WallItem } from '@shared/protocol.ts'

/** The wall's own Mac. An item sent from it carries no `host` at all, so the
 *  band's key for it is the one string a hostname cannot be. */
export const LOCAL = ''

export const hostOf = (item: WallItem): string => item.host ?? LOCAL

export const hostLabel = (host: string): string => (host === LOCAL ? 'local' : host)

/** No Mac picked is every Mac, so the band starts unfiltered and emptying it
 *  again is how the filter is cleared. */
export const keptByHost = (item: WallItem, hosts: ReadonlySet<string>): boolean =>
  hosts.size === 0 || hosts.has(hostOf(item))

/**
 * How many cards each Mac sent, the wall's own first and the rest by name.
 * Empty while every card is local: one row filters nothing. A picked Mac keeps
 * its row at zero once its cards are gone — hosts are not a fixed list, so the
 * row is the only way left to unpick it.
 */
export function hostTally(
  items: readonly WallItem[],
  picked: ReadonlySet<string> = new Set(),
): { key: string; label: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const key of picked) counts.set(key, 0)
  for (const item of items) {
    const key = hostOf(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  if ([...counts.keys()].every((key) => key === LOCAL)) return []
  return [...counts.keys()]
    .sort((a, b) => (a === LOCAL ? -1 : b === LOCAL ? 1 : a.localeCompare(b)))
    .map((key) => ({ key, label: hostLabel(key), count: counts.get(key) ?? 0 }))
}
