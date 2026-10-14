import type { PrefGroup } from '@weasel-js/prefs'
import type { SheetPage } from '@/schema/sheet.ts'

export type PrefsTab = {
  id: string
  label: string
  /** 0 for a surface, 1 for an area nested under one. */
  depth: 0 | 1
  /** The page this tab shows alone. Absent shows every param. */
  page?: PrefGroup
}

export const GENERAL = 'general'
export const ALL = 'params'

const EVERYTHING: PrefsTab = { id: ALL, label: ALL, depth: 0 }

/**
 * The sheet's tab list: `general` first, then `params` with one nested tab per
 * page of the sheet's schema, each called what its page is named.
 *
 * `general` is the few settings worth finding first, drawn from wherever they
 * live rather than from one part of the wall, and it carries the daemon's own
 * lifetime too — the one setting here that holds for every browser rather than
 * this one.
 */
export function prefsTabs(pages: readonly SheetPage[]): PrefsTab[] {
  const tab = (page: SheetPage, id: string, depth: 0 | 1): PrefsTab => ({
    id,
    label: page.root.name,
    depth,
    page: page.root,
  })
  return [
    ...pages.filter((p) => p.id === GENERAL).map((p) => tab(p, GENERAL, 0)),
    EVERYTHING,
    ...pages.filter((p) => p.id !== GENERAL).map((p) => tab(p, `${ALL}.${p.id}`, 1)),
  ]
}

/** The remembered tab if the list still has it, else the first one. */
export function resolveTab(tabs: readonly PrefsTab[], id: string | null): PrefsTab {
  return tabs.find((tab) => tab.id === id) ?? tabs[0] ?? EVERYTHING
}

/** The tab `delta` rows from `id`, wrapping at either end. */
export function stepTab(tabs: readonly PrefsTab[], id: string, delta: number): PrefsTab {
  const at = Math.max(0, tabs.findIndex((tab) => tab.id === id))
  const next = tabs[(at + delta + tabs.length) % tabs.length]
  return next ?? resolveTab(tabs, id)
}
