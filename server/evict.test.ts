import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WallItem } from '@shared/protocol.ts'

async function freshStore(root: string) {
  process.env.TRANSOM_ROOT = root
  vi.resetModules()
  return await import('./store.ts')
}

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'transom-evict-'))
  await mkdir(join(root, 'inbox', 'z'), { recursive: true })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function card(store: Awaited<ReturnType<typeof freshStore>>, id: string, over: Partial<WallItem> = {}) {
  const sourcePath = join(root, 'inbox', 'z', `${id}.png`)
  await writeFile(sourcePath, 'png')
  const item = { id, url: '', origUrl: '', zone: 'z', name: id, path: sourcePath, bornAt: 1000, w: 1, h: 1, ...over } as WallItem
  store.add({ item, sourcePath, cachePath: join(root, '.cache', `${id}.webp`) })
}

describe('evictable', () => {
  it('lists unpinned cards oldest first, with every file they hold', async () => {
    const store = await freshStore(root)
    await card(store, 'young', { bornAt: 2000 })
    await card(store, 'old', { bornAt: 1000 })
    await card(store, 'pinned', { bornAt: 500, keptAt: 600 })
    const list = store.evictable()
    expect(list.map((c) => c.id)).toEqual(['old', 'young'])
    expect(list[0]!.paths).toEqual([join(root, 'inbox', 'z', 'old.png'), join(root, '.cache', 'old.webp')])
  })
  it('passes over an open question', async () => {
    const store = await freshStore(root)
    await card(store, 'q', { question: 'which?' })
    expect(store.evictable()).toEqual([])
  })
})

describe('evict', () => {
  it('moves the card to the trash, tells listeners, and leaves no undo', async () => {
    const store = await freshStore(root)
    await card(store, 'a')
    const heard: string[] = []
    store.onExpire((id) => heard.push(id))
    expect(await store.evict('a')).toBe(true)
    expect(heard).toEqual(['a'])
    expect(existsSync(join(root, 'inbox', 'z', 'a.png'))).toBe(false)
    expect(existsSync(join(root, 'trash', 'a-z'))).toBe(true)
    expect(await store.undoExpiry()).toEqual([])
  })
})

describe('inUse', () => {
  it('names every artifact id and cache file on the wall', async () => {
    const store = await freshStore(root)
    await card(store, 'a')
    const { ids, caches } = store.inUse()
    expect([...ids]).toEqual(['a'])
    expect([...caches]).toEqual([join(root, '.cache', 'a.webp')])
  })
})
