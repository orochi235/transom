import { lstat, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { Disk } from '@shared/protocol.ts'
import { bytesOf, pruneByAge, pruneEmptyDirs, pruneToSize, rotateLog, touchedAt, tryRm } from './reaper.ts'

export type ReapDeps = {
  dirs: { inbox: string; cache: string; trash: string; answers: string; marks: string; incoming: string; logs: string; zones: string }
  limits: {
    trashMs: number; trashMaxBytes: number; wallMaxBytes: number
    logMaxBytes: number; answersMs: number; incomingMs: number
  }
  inUse: () => { ids: Set<string>; caches: Set<string> }
  evictable: () => { id: string; bornAt: number; paths: string[] }[]
  evict: (id: string) => Promise<boolean>
}

/** One pass over everything the wall writes. Order matters: eviction moves
 *  cards into the trash, so the trash is bounded after it. */
export async function reap(d: ReapDeps, now = Date.now()): Promise<Disk> {
  const { dirs, limits } = d

  const { ids, caches } = d.inUse()
  for (const name of await readdir(dirs.cache).catch(() => [] as string[])) {
    const path = join(dirs.cache, name)
    if (caches.has(path)) continue
    // Ingest writes the thumbnail before the store holds the card.
    const st = await lstat(path).catch(() => null)
    if (st && touchedAt(st) < now - limits.incomingMs) await tryRm(path)
  }

  let wallBytes = (await bytesOf(dirs.inbox)) + (await bytesOf(dirs.cache))
  for (const card of d.evictable()) {
    if (wallBytes <= limits.wallMaxBytes) break
    let bytes = 0
    for (const p of card.paths) bytes += await bytesOf(p)
    if (await d.evict(card.id)) wallBytes -= bytes
  }

  await pruneByAge(dirs.trash, limits.trashMs, now)
  await pruneToSize(dirs.trash, limits.trashMaxBytes)
  await pruneByAge(dirs.answers, limits.answersMs, now)
  await pruneByAge(dirs.incoming, limits.incomingMs, now)
  // A record and its composite share the artifact id; `waiting/` is the hook's
  // flags, and `remote/` the drawings the hook fetched from another wall.
  await pruneByAge(dirs.marks, limits.trashMs, now, (name) =>
    name === 'waiting' || name === 'remote' || ids.has(basename(name, extname(name))),
  )

  await pruneEmptyDirs(dirs.inbox, limits.trashMs, now)
  // The CLI rewrites a zone's record on every send, so one for a zone with no
  // inbox left is only a root `zoneColors` would go on polling.
  await pruneByAge(dirs.zones, limits.trashMs, now, (name) =>
    !name.endsWith('.json') || existsSync(join(dirs.inbox, basename(name, '.json'))),
  )

  for (const name of await readdir(dirs.logs).catch(() => [] as string[])) {
    if (!name.endsWith('.log')) continue
    const path = join(dirs.logs, name)
    await rotateLog(path, limits.logMaxBytes).catch((err) =>
      console.error('[reap] could not rotate', path, (err as NodeJS.ErrnoException).code),
    )
  }

  return {
    wallBytes,
    wallMax: limits.wallMaxBytes,
    trashBytes: await bytesOf(dirs.trash),
    over: wallBytes > limits.wallMaxBytes,
  }
}
