import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reap, type ReapDeps } from './reap.ts'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'transom-reap-'))
  for (const d of ['inbox/z', '.cache', 'trash', 'answers', 'marks/waiting', '.incoming', 'logs'])
    await mkdir(join(root, d), { recursive: true })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const later = (h: number) => Date.now() + h * 3_600_000

function deps(over: Partial<ReapDeps> = {}): ReapDeps {
  return {
    dirs: {
      inbox: join(root, 'inbox'), cache: join(root, '.cache'), trash: join(root, 'trash'),
      answers: join(root, 'answers'), marks: join(root, 'marks'), incoming: join(root, '.incoming'),
      logs: join(root, 'logs'),
    },
    limits: { trashMs: 86_400_000, trashMaxBytes: 1000, wallMaxBytes: 1000, logMaxBytes: 100, answersMs: 86_400_000, incomingMs: 3_600_000 },
    inUse: () => ({ ids: new Set(), caches: new Set() }),
    evictable: () => [],
    evict: async () => true,
    ...over,
  }
}

describe('reap', () => {
  it('empties the trash, answers, partial uploads and orphan marks by age', async () => {
    await writeFile(join(root, 'trash', 'a-z'), 'x')
    await writeFile(join(root, 'answers', 'q.png'), 'answered\n')
    await writeFile(join(root, '.incoming', 'u1'), 'half')
    await writeFile(join(root, 'marks', 'gone.json'), '{}')
    await writeFile(join(root, 'marks', 'live.json'), '{}')
    await writeFile(join(root, 'marks', 'waiting', 's1'), '')
    await reap(deps({ inUse: () => ({ ids: new Set(['live']), caches: new Set() }) }), later(25))
    expect(existsSync(join(root, 'trash', 'a-z'))).toBe(false)
    expect(existsSync(join(root, 'answers', 'q.png'))).toBe(false)
    expect(existsSync(join(root, '.incoming', 'u1'))).toBe(false)
    expect(existsSync(join(root, 'marks', 'gone.json'))).toBe(false)
    expect(existsSync(join(root, 'marks', 'live.json'))).toBe(true)
    expect(existsSync(join(root, 'marks', 'waiting', 's1'))).toBe(true)
  })

  it('deletes thumbnails no card uses once they are an hour old', async () => {
    await writeFile(join(root, '.cache', 'keep.webp'), 'x')
    await writeFile(join(root, '.cache', 'orphan.webp'), 'x')
    const d = deps({ inUse: () => ({ ids: new Set(), caches: new Set([join(root, '.cache', 'keep.webp')]) }) })
    // Ingest writes the thumbnail before the store holds the card, so a fresh
    // orphan may be a card halfway in.
    await reap(d)
    expect(existsSync(join(root, '.cache', 'orphan.webp'))).toBe(true)
    await reap(d, later(2))
    expect(existsSync(join(root, '.cache', 'keep.webp'))).toBe(true)
    expect(existsSync(join(root, '.cache', 'orphan.webp'))).toBe(false)
  })

  it('evicts oldest first until the wall fits, and reports over when pins alone exceed it', async () => {
    const a = join(root, 'inbox', 'z', 'a.png')
    const b = join(root, 'inbox', 'z', 'b.png')
    const pinned = join(root, 'inbox', 'z', 'p.png')
    await writeFile(a, Buffer.alloc(600))
    await writeFile(b, Buffer.alloc(600))
    await writeFile(pinned, Buffer.alloc(200))
    const taken: string[] = []
    const d = deps({
      evictable: () => [{ id: 'a', bornAt: 1, paths: [a] }, { id: 'b', bornAt: 2, paths: [b] }],
      evict: async (id) => {
        taken.push(id)
        await rm(id === 'a' ? a : b)
        return true
      },
    })
    const disk = await reap(d)
    expect(taken).toEqual(['a'])
    expect(disk.over).toBe(false)
    expect(disk.wallBytes).toBe(800)

    const tight = await reap({ ...d, evictable: () => [], limits: { ...d.limits, wallMaxBytes: 100 } })
    expect(tight.over).toBe(true)
  })

  it('rotates every log over the cap', async () => {
    await writeFile(join(root, 'logs', 'daemon.log'), 'x'.repeat(200))
    await writeFile(join(root, 'logs', 'client.log'), 'x')
    await reap(deps())
    expect(existsSync(join(root, 'logs', 'daemon.log.1'))).toBe(true)
    expect(existsSync(join(root, 'logs', 'client.log.1'))).toBe(false)
  })
})
