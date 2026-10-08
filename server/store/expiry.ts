import { rename, mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { config } from '../config.ts'
import { trashStamp } from '../sidecar.ts'
import { ttlMs as wallTtlMs } from '../settings.ts'
import { lifetimeFor as zoneLifetime } from '../zones.ts'
import type { WallItem } from '@shared/protocol.ts'
import * as marks from '../markup.ts'
import { isEternal, lifetimeMs } from '@shared/lifetime.ts'
import { artifactsOf, entries, filesOf, isHeld, listeners, takeOwner, type Entry } from './entries.ts'
import { closeAll } from './questions.ts'
import { syncWaiting } from './marks.ts'

/** Whether a card may be evicted for space: not held, not in an eternal zone. */
const mayEvict = (e: Entry): boolean => !isHeld(e) && !isEternal(zoneLifetime(e.item.zone))

/** What the reaper may take when the wall is over its cap, oldest first. A
 *  pinned card, an open question, undelivered marks and an eternal zone are
 *  never on it. */
export function evictable(): { id: string; bornAt: number; paths: string[] }[] {
  return [...entries.values()]
    .filter(mayEvict)
    .sort((a, b) => a.item.bornAt - b.item.bornAt)
    .map((e) => ({
      id: e.item.id,
      bornAt: e.item.bornAt,
      paths: filesOf(e).flatMap((f) => [f.sourcePath, f.cachePath]),
    }))
}

/** Every artifact id and thumbnail a card on the wall still uses. */
export function inUse(): { ids: Set<string>; caches: Set<string> } {
  const ids = new Set<string>()
  const caches = new Set<string>()
  for (const e of entries.values()) {
    for (const [id, f] of artifactsOf(e)) {
      ids.add(id)
      caches.add(f.cachePath)
    }
  }
  return { ids, caches }
}

/** Expiry for space. Announced like a TTL running out, so never an undo step. */
export async function evict(id: string): Promise<boolean> {
  const entry = entries.get(id)
  if (!entry || !mayEvict(entry)) return false
  await expire(entry)
  return true
}

export function onExpire(fn: (id: string) => void) {
  listeners.add(fn)
}

/** Every file one expiry moved, since a group takes its whole carousel with it. */
type Gone = { entry: Entry; moves: { from: string; to: string }[] }

/** The expiries a person asked for, oldest first, each the artifacts one step
 *  took — a whole zone goes and comes back as one. A TTL running out is never
 *  a step: on a busy wall it would bury a deliberate expiry within the second. */
const undoable: Gone[][] = []
const UNDO_DEPTH = 10

function remember(step: Gone[]) {
  undoable.push(step)
  if (undoable.length > UNDO_DEPTH) undoable.shift()
}

/** Expiry moves the source file to the trash; the wall never unlinks. A group
 *  takes every take with it: the group is the unit of lifetime, and a take left
 *  in the inbox would be adopted as a card of its own on the next sweep. */
async function expire(entry: Entry): Promise<Gone> {
  await closeAll(entry, 'expired')
  entries.delete(entry.item.id)
  for (const take of entry.item.takes ?? []) takeOwner.delete(take.id)
  await mkdir(config.trash, { recursive: true })
  const moves: { from: string; to: string }[] = []
  for (const [at, files] of filesOf(entry).entries()) {
    // One name per file, so a group's takes cannot land on top of each other.
    const dest = join(config.trash, `${entry.item.id}${at === 0 ? '' : `-${at}`}-${entry.item.zone}`)
    await rename(files.sourcePath, dest).catch(() => {})
    await trashStamp(files.sourcePath, dest)
    moves.push({ from: files.sourcePath, to: dest })
  }
  // A drawing goes with its card, and comes back with it on an undo.
  for (const [id, files] of artifactsOf(entry)) {
    if (!files.marks) continue
    for (const from of marks.filesOf(id)) {
      const to = join(config.trash, `${entry.item.id}-marks-${basename(from)}`)
      if (await rename(from, to).then(() => true, () => false)) moves.push({ from, to })
    }
    if (files.marks.status === 'pending' && files.marks.sender) await syncWaiting(files.marks.sender.session)
  }
  for (const fn of listeners) fn(entry.item.id)
  return { entry, moves }
}

/** Returns the stop, for a test that must not leave a sweep running. */
export function startSweeper(): () => void {
  const timer = setInterval(() => {
    const now = Date.now()
    for (const entry of entries.values()) {
      // An open question has someone waiting on it.
      if (isHeld(entry)) continue
      // A question can stay open for longer than a TTL, so an answered card
      // gets a whole life from its answer — and a group from its last one, since
      // reviewing the twelfth take is not a reason to have already dropped it.
      // A drawing resolved gets the same: the composite's path went to its
      // sender, who may not read it for a while.
      const replies = (entry.item.takes ?? []).map((t) => t.reply?.at ?? 0)
      const resolved = artifactsOf(entry).map(([, f]) => f.marks?.resolvedAt ?? 0)
      const from = Math.max(entry.item.bornAt, entry.item.reply?.at ?? 0, ...replies, ...resolved)
      // The item's own, then its zone's, then the wall's. Read per sweep
      // rather than stamped at arrival, so shortening a zone's lifetime
      // reaches what is already hanging in it.
      //
      // A zone held off the clock resolves to Infinity, which this comparison
      // is already false against — so neither hold needs a case here.
      const ttl = entry.item.ttlMs ?? lifetimeMs(zoneLifetime(entry.item.zone) ?? wallTtlMs())
      if (from < now - ttl) void expire(entry)
    }
  }, 1000)
  return () => clearInterval(timer)
}

/** Expiry on demand. False when there is no such item, so the caller does not
 *  announce a death that did not happen. */
export async function expireNow(id: string): Promise<boolean> {
  const entry = entries.get(id)
  if (!entry) return false
  remember([await expire(entry)])
  return true
}

/**
 * Everything in a zone, as one undo step. The ids come back so the caller can
 * announce each death on the same `expire` message a natural one sends — a
 * client cannot tell a zone being cleared from thirty TTLs running out at once,
 * and needs no second path for it.
 *
 * A kept artifact is not swept, but it is taken here: rescuing something says
 * the wall must not drop it on its own, not that it cannot be dismissed.
 *
 * An eternal zone is the exception, and the only thing that separates the two
 * holds: taking a whole zone at once is the collector that promise is against.
 * The card's own Expire is one deliberate act on one artifact and still lands.
 */
export async function expireZone(zone: string): Promise<string[]> {
  if (isEternal(zoneLifetime(zone))) return []
  const doomed = [...entries.values()].filter((e) => e.item.zone === zone)
  if (doomed.length === 0) return []
  const gone: Gone[] = []
  for (const entry of doomed) gone.push(await expire(entry))
  remember(gone)
  return gone.map((g) => g.entry.item.id)
}

/**
 * Puts the most recent step back, or nothing when there is none left.
 *
 * It returns with a fresh `bornAt`: restored at its old one it would be past
 * its TTL already and the sweeper would take it again within the second, which
 * looks exactly like undo not working.
 */
export async function undoExpiry(): Promise<WallItem[]> {
  const last = undoable.pop()
  if (!last) return []
  const back: WallItem[] = []
  for (const gone of last) {
    let restored = 0
    for (const move of gone.moves) {
      try {
        await rename(move.to, move.from)
      } catch {
        // One take that will not come back must not strand the rest of its group.
        continue
      }
      await trashStamp(move.to, move.from)
      restored++
    }
    // One file that will not come back must not strand the rest of its zone.
    if (restored === 0) continue
    // Its old bornAt is already past its TTL, so it would be swept again on the
    // next tick.
    const item = { ...gone.entry.item, bornAt: Date.now() }
    const entry = { ...gone.entry, item }
    entries.set(item.id, entry)
    for (const take of item.takes ?? []) takeOwner.set(take.id, item.id)
    for (const [, files] of artifactsOf(entry)) {
      if (files.marks?.status === 'pending' && files.marks.sender) await syncWaiting(files.marks.sender.session)
    }
    back.push(item)
  }
  return back
}
