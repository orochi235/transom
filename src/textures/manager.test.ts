import { describe, expect, it, vi } from 'vitest'
import { createTextureManager } from '@/textures/manager.ts'

const flush = () => new Promise((r) => setTimeout(r, 0))

function harness(budgetBytes = 4 * 1024 * 1024) {
  const disposed: string[] = []
  const manager = createTextureManager<string>({
    budgetBytes,
    urlFor: (id) => `/img/${id}`,
    load: async (_url, edge) => ({ value: `tex-${edge}`, bytes: edge * edge * 4 }),
    dispose: (v) => disposed.push(v),
  })
  return { manager, disposed }
}

describe('createTextureManager', () => {
  it('says when a texture lands, and says nothing for a load that failed', async () => {
    const landed = vi.fn()
    const manager = createTextureManager<string>({
      budgetBytes: 4 * 1024 * 1024,
      urlFor: (id) => `/img/${id}`,
      load: async (url, edge) => (url.endsWith('bad') ? null : { value: `tex-${edge}`, bytes: edge * edge * 4 }),
      dispose: () => {},
      onLoad: landed,
    })
    manager.sync(new Map([['good', 128], ['bad', 128]]))
    await flush()
    expect(landed).toHaveBeenCalledTimes(1)
  })

  it('has nothing on the first frame and uploads for the next one', async () => {
    const { manager } = harness()
    expect(manager.textureFor('a')).toBeUndefined()
    manager.sync(new Map([['a', 512]]))
    await flush()
    expect(manager.textureFor('a')).toBe('tex-512')
  })

  it('downgrades an item that sank down the pile', async () => {
    const { manager, disposed } = harness()
    manager.sync(new Map([['a', 512]]))
    await flush()
    manager.sync(new Map([['a', 128]]))
    await flush()
    expect(manager.textureFor('a')).toBe('tex-128')
    expect(disposed).toContain('tex-512')
  })

  it('never upgrades, so a stale frame cannot force a re-decode', async () => {
    const { manager } = harness()
    manager.sync(new Map([['a', 128]]))
    await flush()
    manager.sync(new Map([['a', 512]]))
    await flush()
    expect(manager.textureFor('a')).toBe('tex-128')
  })

  it('drops an item that left the wall', async () => {
    const { manager, disposed } = harness()
    manager.sync(new Map([['a', 128]]))
    await flush()
    manager.sync(new Map())
    expect(manager.textureFor('a')).toBeUndefined()
    expect(disposed).toContain('tex-128')
  })

  it('holds no texture at all for the past-the-fade tier', async () => {
    const { manager } = harness()
    manager.sync(new Map([['a', 0]]))
    await flush()
    expect(manager.textureFor('a')).toBeUndefined()
  })

  it('does not start a second load while the first is in flight', async () => {
    const load = vi.fn().mockResolvedValue({ value: 'tex', bytes: 4 })
    const manager = createTextureManager<string>({
      budgetBytes: 1024,
      urlFor: (id) => `/img/${id}`,
      load,
      dispose: () => {},
    })
    manager.sync(new Map([['a', 32]]))
    manager.sync(new Map([['a', 32]]))
    await flush()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('reloads a card whose picture moved to a new URL, keeping the old one up meanwhile', async () => {
    let url = '/img/a?v=1'
    const disposed: string[] = []
    const manager = createTextureManager<string>({
      budgetBytes: 4 * 1024 * 1024,
      urlFor: () => url,
      load: async (at, edge) => ({ value: `${at}@${edge}`, bytes: edge * edge * 4 }),
      dispose: (v) => disposed.push(v),
    })
    manager.sync(new Map([['a', 512]]))
    await flush()
    url = '/img/a?v=2'
    manager.sync(new Map([['a', 512]]))
    expect(manager.textureFor('a')).toBe('/img/a?v=1@512')
    await flush()
    expect(manager.textureFor('a')).toBe('/img/a?v=2@512')
    expect(disposed).toContain('/img/a?v=1@512')
  })

  it('disposes everything on a lost context', async () => {
    const { manager, disposed } = harness()
    manager.sync(new Map([['a', 128]]))
    await flush()
    manager.clear()
    expect(disposed).toContain('tex-128')
    expect(manager.textureFor('a')).toBeUndefined()
  })
})
