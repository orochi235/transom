import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WallItem } from '@shared/protocol.ts'
import { KEEP_CAP } from '@shared/keep.ts'

async function freshStore(root: string) {
  process.env.TRANSOM_ROOT = root
  vi.resetModules()
  return await import('./store.ts')
}
type Store = Awaited<ReturnType<typeof freshStore>>

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'transom-keep-'))
  await mkdir(join(root, 'inbox', 'z'), { recursive: true })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function card(store: Store, id: string) {
  const sourcePath = join(root, 'inbox', 'z', `${id}.png`)
  await writeFile(sourcePath, 'png')
  const item = { id, url: '', origUrl: '', zone: 'z', name: id, path: sourcePath, bornAt: 1000, w: 1, h: 1 } as WallItem
  store.add({ item, sourcePath, cachePath: join(root, `${id}.webp`) })
  return sourcePath
}

const keptIds = (store: Store) => store.snapshot().filter((i) => i.keptAt !== undefined).map((i) => i.id)

describe('keep', () => {
  it('writes the rescue to the sidecar, where a restart will find it', async () => {
    const store = await freshStore(root)
    const source = await card(store, 'a1')

    const kept = await store.keep('a1', true)
    if (typeof kept !== 'object') throw new Error(`kept was ${kept}`)
    expect(typeof kept.keptAt).toBe('number')
    expect(store.snapshot()[0]?.keptAt).toBe(kept.keptAt)
    expect(JSON.parse(await readFile(`${source}.transom.json`, 'utf8')).kept).toBe(
      new Date(kept.keptAt!).toISOString(),
    )

    await store.keep('a1', false)
    expect(store.snapshot()[0]?.keptAt).toBeUndefined()
    expect(JSON.parse(await readFile(`${source}.transom.json`, 'utf8')).kept).toBeUndefined()
  })

  it('says so rather than throwing when the wall has already forgotten the item', async () => {
    const store = await freshStore(root)
    expect(await store.keep('gone', true)).toBe(false)
  })
})

describe('the keep cap', () => {
  async function full(store: Store) {
    for (let i = 0; i < KEEP_CAP; i++) {
      await card(store, `k${i}`)
      await store.keep(`k${i}`, true)
    }
    await card(store, 'new')
  }

  it('refuses one more without a pin to replace, and changes nothing', async () => {
    const store = await freshStore(root)
    await full(store)
    expect(await store.keep('new', true)).toBe('full')
    expect(keptIds(store)).toHaveLength(KEEP_CAP)
    expect(keptIds(store)).not.toContain('new')
  })

  it('takes one more by letting the named pin go, on disk as well', async () => {
    const store = await freshStore(root)
    await full(store)
    const kept = await store.keep('new', true, 'k3')
    expect(kept).toMatchObject({ released: 'k3' })
    expect(keptIds(store)).toContain('new')
    expect(keptIds(store)).not.toContain('k3')
    expect(keptIds(store)).toHaveLength(KEEP_CAP)
    const sidecar = JSON.parse(await readFile(join(root, 'inbox', 'z', 'k3.png.transom.json'), 'utf8'))
    expect(sidecar.kept).toBeUndefined()
  })

  it('refuses a replacement that is not itself kept', async () => {
    const store = await freshStore(root)
    await full(store)
    await card(store, 'loose')
    expect(await store.keep('new', true, 'loose')).toBe('full')
  })

  it('lets a kept item be re-kept or let go at the cap', async () => {
    const store = await freshStore(root)
    await full(store)
    expect(await store.keep('k0', true)).toMatchObject({ keptAt: expect.any(Number) })
    expect(await store.keep('k0', false)).toEqual({ keptAt: null })
  })
})
