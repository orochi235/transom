import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WallItem } from '@shared/protocol.ts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const png = () =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).png().toBuffer()

/** `config` reads the environment once at import, so each case gets its own
 *  root and its own module graph. */
async function bootDaemon(root: string) {
  vi.resetModules()
  vi.stubEnv('TRANSOM_ROOT', root)
  vi.stubEnv('TRANSOM_SWEEP_MS', '40')
  vi.stubEnv('TRANSOM_INGEST_AT_ONCE', '1')
  await mkdir(join(root, 'inbox'), { recursive: true })
  return await import('./ingest.ts')
}

describe('watchInbox', () => {
  let root = ''
  let stop: (() => Promise<void>) | null = null

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'transom-watch-'))
  })

  afterEach(async () => {
    await stop?.()
    stop = null
    vi.unstubAllEnvs()
    vi.resetModules()
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('is ready only once every file present at startup is adopted', async () => {
    const { watchInbox } = await bootDaemon(root)
    const store = await import('./store.ts')
    await mkdir(join(root, 'inbox', 'z'), { recursive: true })
    // Large enough that ingest is still working when the watcher reports ready.
    const big = await sharp(randomBytes(2400 * 2400 * 3), { raw: { width: 2400, height: 2400, channels: 3 } })
      .png()
      .toBuffer()
    for (let i = 0; i < 8; i++) await writeFile(join(root, 'inbox', 'z', `a${i}.png`), big)
    const w = watchInbox(() => {})
    stop = () => w.close()
    await w.ready
    expect(store.snapshot()).toHaveLength(8)
  }, 60_000)

  it('takes in an artifact and reports it under its zone', async () => {
    const { watchInbox } = await bootDaemon(root)
    const arrived: WallItem[] = []
    const w = watchInbox((landed) => arrived.push(landed.item))
    stop = () => w.close()

    await mkdir(join(root, 'inbox', 'brick-icons'), { recursive: true })
    await writeFile(join(root, 'inbox', 'brick-icons', 'a.png'), await png())

    await vi.waitFor(() => expect(arrived).toHaveLength(1), { timeout: 8000 })
    expect(arrived[0]!.zone).toBe('brick-icons')
    expect(arrived[0]!.w).toBe(8)
  })

  it('reports it once however many times the file is touched', async () => {
    // Ingest rewrites the source to stamp it and then restores its mtime, so
    // every artifact fires further events after it has already been taken in.
    const { watchInbox } = await bootDaemon(root)
    const arrived: WallItem[] = []
    const w = watchInbox((landed) => arrived.push(landed.item))
    stop = () => w.close()

    const f = join(root, 'inbox', 'z', 'a.png')
    await mkdir(join(root, 'inbox', 'z'), { recursive: true })
    await writeFile(f, await png())
    await vi.waitFor(() => expect(arrived).toHaveLength(1), { timeout: 8000 })

    for (let i = 0; i < 3; i++) {
      await utimes(f, new Date(), new Date())
      await sleep(120)
    }
    await sleep(400)
    expect(arrived).toHaveLength(1)
  })

  it('takes in an artifact that was already there when it started', async () => {
    await mkdir(join(root, 'inbox', 'weasel'), { recursive: true })
    await writeFile(join(root, 'inbox', 'weasel', 'old.png'), await png())

    const { watchInbox } = await bootDaemon(root)
    const arrived: WallItem[] = []
    const w = watchInbox((landed) => arrived.push(landed.item))
    stop = () => w.close()

    await vi.waitFor(() => expect(arrived).toHaveLength(1), { timeout: 8000 })
    expect(arrived[0]!.zone).toBe('weasel')
  })

  it('costs one watch handle however many artifacts the inbox holds', async () => {
    // The whole reason for the backend. A descriptor per watched path grows
    // the daemon's cost with the wall, and an exhausted table stops the page
    // shot and the wall browser from spawning long before anything blames the
    // watcher.
    const dir = join(root, 'inbox', 'z')
    await mkdir(dir, { recursive: true })
    const bytes = await png()
    for (let i = 0; i < 60; i++) await writeFile(join(dir, `a${i}.png`), bytes)

    const { watchInbox } = await bootDaemon(root)
    // Counted by path, not by delta: sibling test files hold watchers of their
    // own in this worker, and a delta reads theirs as ours.
    const ours = () =>
      (process.report.getReport() as { libuv: Array<{ type: string; filename?: string }> }).libuv
        .filter((h) => h.type === 'fs_event' && h.filename?.includes(root))
        .map((h) => h.filename)

    const w = watchInbox(() => {})
    stop = () => w.close()
    await sleep(500)

    expect(ours()).toHaveLength(1)
  })

  it('lands every take of a group on one card, and appends the rest', async () => {
    const { watchInbox } = await bootDaemon(root)
    const landed: { as: string; id: string }[] = []
    const w = watchInbox((l) => landed.push({ as: l.as, id: l.item.id }))
    stop = () => w.close()

    const dir = join(root, 'inbox', 'z')
    await mkdir(dir, { recursive: true })
    for (const name of ['a', 'b', 'c']) {
      await writeFile(
        join(dir, `${name}.png.transom.json`),
        JSON.stringify({ group: 'sweep', groupLabel: 'outline sweep', of: 3, question: 'reads?' }),
      )
      await writeFile(join(dir, `${name}.png`), await png())
    }

    await vi.waitFor(() => expect(landed).toHaveLength(3), { timeout: 8000 })
    // One card, and only the first landing opened it.
    expect(new Set(landed.map((l) => l.id)).size).toBe(1)
    expect(landed.every((l) => l.as === 'take')).toBe(true)
    const store = await import('./store.ts')
    expect(store.snapshot()).toHaveLength(1)
    const card = store.snapshot()[0]!
    expect(card.kind).toBe('group')
    expect(card.name).toBe('outline sweep')
    expect(card.takes).toHaveLength(3)
    // The card draws a take, so its own url is one of theirs.
    expect(card.takes?.map((t) => t.url)).toContain(card.url)
  })

  it('leaves the sidecar alone', async () => {
    const { watchInbox } = await bootDaemon(root)
    const arrived: WallItem[] = []
    const w = watchInbox((landed) => arrived.push(landed.item))
    stop = () => w.close()

    const dir = join(root, 'inbox', 'z')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'a.png.transom.json'), '{"caption":"c"}')
    await writeFile(join(dir, 'a.png'), await png())

    await vi.waitFor(() => expect(arrived).toHaveLength(1), { timeout: 8000 })
    await sleep(300)
    expect(arrived).toHaveLength(1)
    expect(arrived[0]!.name).toBe('c')
  })
})
