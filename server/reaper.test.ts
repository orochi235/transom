import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bytesOf, pruneByAge, pruneToSize, rotateLog } from './reaper.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'transom-reaper-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A file of `size` bytes with its mtime set to `mtime`. Its ctime is the
 *  real now, so tests pass `now` near Date.now() for ctime to count. */
async function file(name: string, size: number, mtime: number) {
  const p = join(dir, name)
  await writeFile(p, Buffer.alloc(size))
  await utimes(p, mtime / 1000, mtime / 1000)
  return p
}

describe('pruneByAge', () => {
  it('deletes what was last touched before the cutoff, and keeps the rest', async () => {
    const now = Date.now()
    await file('old', 1, now - 3 * 3_600_000)
    await file('new', 1, now)
    // ctime is now for both, so age by touch keeps both until the clock moves.
    expect(await pruneByAge(dir, 3_600_000, now)).toBe(0)
    expect(await pruneByAge(dir, 3_600_000, now + 2 * 3_600_000)).toBe(2)
    expect(readdirSync(dir)).toEqual([])
  })
  it('passes over what `keep` names', async () => {
    const now = Date.now()
    await file('a', 1, now)
    await mkdir(join(dir, 'waiting'))
    expect(await pruneByAge(dir, 1, now + 10_000, (n) => n === 'waiting')).toBe(1)
    expect(readdirSync(dir)).toEqual(['waiting'])
  })
  it('is nothing for a directory that does not exist', async () => {
    expect(await pruneByAge(join(dir, 'nope'), 1, Date.now())).toBe(0)
  })
})

describe('pruneToSize', () => {
  it('deletes oldest first until under the cap', async () => {
    const now = Date.now()
    await file('a', 100, now - 3000)
    await file('b', 100, now - 2000)
    await file('c', 100, now - 1000)
    // utimes bumps ctime to now, so each file's age is when it was written:
    // a, then b, then c.
    expect(await pruneToSize(dir, 150)).toBe(2)
    expect(readdirSync(dir)).toEqual(['c'])
  })
  it('deletes one entry bigger than the whole cap and stops', async () => {
    await file('huge', 500, Date.now())
    expect(await pruneToSize(dir, 100)).toBe(1)
    expect(readdirSync(dir)).toEqual([])
  })
  it('counts a directory by everything inside it', async () => {
    await mkdir(join(dir, 'd'))
    await writeFile(join(dir, 'd', 'x'), Buffer.alloc(300))
    expect(await bytesOf(join(dir, 'd'))).toBe(300)
    expect(await pruneToSize(dir, 100)).toBe(1)
  })
})

describe('rotateLog', () => {
  it('copies to .1 and truncates in place once over the cap', async () => {
    const log = join(dir, 'daemon.log')
    await writeFile(log, 'x'.repeat(200))
    expect(await rotateLog(log, 100)).toBe(true)
    expect((await readFile(`${log}.1`, 'utf8')).length).toBe(200)
    expect((await readFile(log, 'utf8')).length).toBe(0)
  })
  it('leaves a log under the cap, and a missing one, alone', async () => {
    const log = join(dir, 'daemon.log')
    await writeFile(log, 'x')
    expect(await rotateLog(log, 100)).toBe(false)
    expect(await rotateLog(join(dir, 'none.log'), 100)).toBe(false)
    expect(existsSync(`${log}.1`)).toBe(false)
  })
})

describe('a stuck entry', () => {
  it('does not stop the sweep behind it', async () => {
    const stuck = join(dir, 'a-stuck')
    await mkdir(stuck)
    await writeFile(join(stuck, 'f'), 'x')
    await chmod(stuck, 0o500)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const now = Date.now()
    await file('b-old', 1, now - 3 * 3_600_000)
    try {
      const gone = await pruneByAge(dir, 0, now + 1000)
      expect(existsSync(join(dir, 'b-old'))).toBe(false)
      expect(existsSync(join(stuck, 'f'))).toBe(true)
      expect(gone).toBe(1)
      expect(spy).toHaveBeenCalledWith('[reap] could not delete', stuck, expect.any(String))
    } finally {
      spy.mockRestore()
      await chmod(stuck, 0o700)
    }
  })
})
