import { copyFile, lstat, readdir, rm, truncate } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { join } from 'node:path'

/** When a file was last written or moved. A rename into the trash keeps the
 *  mtime and bumps the ctime (measured on APFS), so mtime alone would age a
 *  card by when it was rendered rather than when it was thrown away. */
export const touchedAt = (st: Stats) => Math.max(st.mtimeMs, st.ctimeMs)

export async function bytesOf(path: string): Promise<number> {
  const st = await lstat(path).catch(() => null)
  if (!st) return 0
  if (!st.isDirectory()) return st.size
  const names = await readdir(path).catch(() => [] as string[])
  let total = 0
  for (const n of names) total += await bytesOf(join(path, n))
  return total
}

type Held = { path: string; at: number; mtime: number; bytes: number }

async function entries(dir: string, keep?: (name: string) => boolean): Promise<Held[]> {
  const names = await readdir(dir).catch(() => [] as string[])
  const out: Held[] = []
  for (const name of names) {
    if (keep?.(name)) continue
    const path = join(dir, name)
    const st = await lstat(path).catch(() => null)
    if (!st) continue
    out.push({ path, at: touchedAt(st), mtime: st.mtimeMs, bytes: await bytesOf(path) })
  }
  return out
}

/** Deletes each top-level entry last touched before `now - maxAgeMs`. */
export async function pruneByAge(
  dir: string,
  maxAgeMs: number,
  now: number,
  keep?: (name: string) => boolean,
): Promise<number> {
  let gone = 0
  for (const e of await entries(dir, keep)) {
    if (e.at >= now - maxAgeMs) continue
    await rm(e.path, { recursive: true, force: true })
    gone++
  }
  return gone
}

/** Deletes the oldest top-level entries until the directory fits `maxBytes`. */
export async function pruneToSize(dir: string, maxBytes: number): Promise<number> {
  const all = await entries(dir)
  all.sort((a, b) => a.at - b.at || a.mtime - b.mtime)
  let total = all.reduce((sum, e) => sum + e.bytes, 0)
  let gone = 0
  for (const e of all) {
    if (total <= maxBytes) break
    await rm(e.path, { recursive: true, force: true })
    total -= e.bytes
    gone++
  }
  return gone
}

/** Copy-and-truncate, which is safe only because launchd opens the log with
 *  O_APPEND: a writer without it keeps its offset and leaves a sparse file. */
export async function rotateLog(file: string, maxBytes: number): Promise<boolean> {
  const st = await lstat(file).catch(() => null)
  if (!st || st.size <= maxBytes) return false
  await copyFile(file, `${file}.1`)
  await truncate(file, 0)
  return true
}
