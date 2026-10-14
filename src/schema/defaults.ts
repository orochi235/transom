import { isPrefLeaf, prefHoldsValue, type PrefGroup } from '@weasel-js/prefs'

/**
 * The value tree a schema's defaults make. A group keyed `0`, `1`, … is a
 * list: a schema key is a path segment and a list's index is one too, so that
 * is how the tiers and the margins are written down.
 */
export function defaultsOf(group: PrefGroup): unknown {
  const entries = Object.entries(group.children).flatMap(([key, child]): [string, unknown][] => {
    if (!isPrefLeaf(child)) return [[key, defaultsOf(child)]]
    return prefHoldsValue(child) ? [[key, child.default]] : []
  })
  const isList = entries.length > 0 && entries.every(([key], i) => key === String(i))
  return isList ? entries.map(([, value]) => value) : Object.fromEntries(entries)
}
