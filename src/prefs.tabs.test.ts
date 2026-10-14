import { describe, expect, it } from 'vitest'
import { prefsTabs, resolveTab, stepTab } from '@/prefs.tabs.ts'

const page = (id: string, name: string) => ({ id, root: { name, children: {} } })
const general = page('general', 'general')
const two = [general, page('piles', 'piles'), page('zones', 'zones & sky')]

describe('prefsTabs', () => {
  it('leads with general, then the whole of params and one nested tab per area', () => {
    const tabs = prefsTabs(two)
    expect(tabs.map((t) => [t.id, t.label, t.depth, t.page?.name])).toEqual([
      ['general', 'general', 0, 'general'],
      ['params', 'params', 0, undefined],
      ['params.piles', 'piles', 1, 'piles'],
      ['params.zones', 'zones & sky', 1, 'zones & sky'],
    ])
  })

  it('shows general alone rather than everything, unlike params', () => {
    const [lead, all] = prefsTabs(two)
    expect(lead?.page).toBe(two[0]?.root)
    expect(all?.page).toBeUndefined()
  })
})

describe('resolveTab', () => {
  const tabs = prefsTabs(two)
  it('keeps a remembered tab the list still has', () => {
    expect(resolveTab(tabs, 'params.zones').page?.name).toBe('zones & sky')
  })
  it('falls back to the first tab for one that is gone', () => {
    expect(resolveTab(tabs, 'params.gone').id).toBe('general')
    expect(resolveTab(tabs, null).id).toBe('general')
  })
  it('lands on general for a browser that remembered the retired wall tab', () => {
    expect(resolveTab(tabs, 'wall').id).toBe('general')
  })
})

describe('stepTab', () => {
  const tabs = prefsTabs(two)
  it('moves by rows and wraps at both ends', () => {
    expect(stepTab(tabs, 'general', 1).id).toBe('params')
    expect(stepTab(tabs, 'general', -1).id).toBe('params.zones')
    expect(stepTab(tabs, 'params.zones', 1).id).toBe('general')
    expect(stepTab(tabs, 'params', -1).id).toBe('general')
  })
})
