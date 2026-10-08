import { mkdtempSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startSweep, sweepOnce } from './inboxSweep.ts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('sweepOnce', () => {
  let root = ''
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  const tree = async (files: string[]) => {
    root = mkdtempSync(join(tmpdir(), 'sw-'))
    for (const f of files) {
      await mkdir(join(root, f.split('/')[0]!), { recursive: true })
      await writeFile(join(root, f), 'x')
    }
    return files.map((f) => join(root, f))
  }

  it('offers an artifact the store never took in', async () => {
    const [known, missed] = await tree(['z/known.png', 'z/missed.png'])
    const offered: string[] = []

    const n = await sweepOnce(root, {
      has: (p) => p === known,
      settleMs: 0,
      onFile: (p) => offered.push(p),
    })

    expect(offered).toEqual([missed])
    expect(n).toBe(1)
  })

  it('offers nothing when the store holds everything', async () => {
    await tree(['z/a.png', 'z/b.png'])
    const offered: string[] = []

    const n = await sweepOnce(root, { has: () => true, settleMs: 0, onFile: (p) => offered.push(p) })

    expect(offered).toEqual([])
    expect(n).toBe(0)
  })

  it('skips what the caller ignores, so sidecars are not offered forever', async () => {
    // A sidecar is never ingested, so the store will never claim to have one.
    // Without this the sweep re-offers every sidecar on every tick.
    const [, sidecar] = await tree(['z/a.png', 'z/a.png.transom.json'])
    const offered: string[] = []

    await sweepOnce(root, {
      has: () => false,
      settleMs: 0,
      ignore: (p) => p.endsWith('.transom.json'),
      onFile: (p) => offered.push(p),
    })

    expect(offered.includes(sidecar)).toBe(false)
  })

  it('leaves a file still being written for a later pass', async () => {
    const [fresh] = await tree(['z/fresh.png'])
    const offered: string[] = []

    expect(await sweepOnce(root, { has: () => false, settleMs: 60_000, onFile: (p) => offered.push(p) })).toBe(0)
    expect(await sweepOnce(root, { has: () => false, settleMs: 0, onFile: (p) => offered.push(p) })).toBe(1)
    expect(offered).toEqual([fresh])
  })

  it('reads no zone at all from an inbox that is not there', async () => {
    root = mkdtempSync(join(tmpdir(), 'sw-'))
    await rm(root, { recursive: true, force: true })
    const offered: string[] = []

    await expect(
      sweepOnce(root, { has: () => false, onFile: (p) => offered.push(p) }),
    ).resolves.toBe(0)
    root = ''
  })
})

describe('startSweep', () => {
  let root = ''
  let stop: (() => void) | null = null

  afterEach(async () => {
    stop?.()
    stop = null
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('keeps offering on a tick until the store takes the artifact', async () => {
    root = mkdtempSync(join(tmpdir(), 'sw-'))
    await mkdir(join(root, 'z'))
    const f = join(root, 'z', 'a.png')
    await writeFile(f, 'x')

    const offered: string[] = []
    stop = startSweep(root, {
      intervalMs: 30,
      settleMs: 0,
      has: () => false,
      onFile: (p) => offered.push(p),
    })

    await sleep(200)
    expect(offered.length).toBeGreaterThan(1)
    expect(new Set(offered)).toEqual(new Set([f]))
  })

  it('stops when told to', async () => {
    root = mkdtempSync(join(tmpdir(), 'sw-'))
    await mkdir(join(root, 'z'))
    await writeFile(join(root, 'z', 'a.png'), 'x')

    const offered: string[] = []
    stop = startSweep(root, { intervalMs: 30, settleMs: 0, has: () => false, onFile: (p) => offered.push(p) })
    await sleep(120)
    stop()
    stop = null

    const seen = offered.length
    expect(seen).toBeGreaterThan(0)
    await sleep(150)
    expect(offered).toHaveLength(seen)
  })
})
