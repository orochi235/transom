import { mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from './config.ts'
import { clearAttention, setKept, trashStamp } from './sidecar.ts'
import type { Poster, Take, WallItem } from '@shared/protocol.ts'
import { MAX_TAKES, posterOf } from '@shared/groups.ts'
import { KEEP_CAP, keptOf } from '@shared/keep.ts'
import { entries, isOpen, listeners, repost, takeOwner, type Entry, type Files } from './store/entries.ts'
import { close, closeAll, closeTake, type Closed } from './store/questions.ts'
import { syncWaiting } from './store/marks.ts'

export type { Closed } from './store/questions.ts'
export { evictable, inUse, evict, onExpire, startSweeper, expireNow, expireZone, undoExpiry } from './store/expiry.ts'
export { markUp, discardMarks, claimMarks, recheckSenders, type MarkNews, type Claimed } from './store/marks.ts'

export function add(entry: { item: WallItem } & Files) {
  entries.set(entry.item.id, { ...entry, takes: new Map() })
}

/** The card a file hangs on: its own, or the group's it is a take of. */
export function cardAt(sourcePath: string): WallItem | null {
  for (const e of entries.values()) {
    if (e.takes.size === 0) {
      if (e.sourcePath === sourcePath) return e.item
      continue
    }
    // A group's own sourcePath is a copy of a take's, so only the takes are
    // asked: the sweep must re-offer nothing, and must not skip a take either.
    for (const f of e.takes.values()) if (f.sourcePath === sourcePath) return e.item
  }
  return null
}

export const has = (sourcePath: string) => cardAt(sourcePath) !== null

/**
 * Adds a take to a group, opening the group's card if this is its first.
 *
 * Synchronous on purpose, and called with every `await` already finished: two
 * takes landing in the same tick must not both create the group. The failure
 * would be two cards with the same name holding half the takes each, and it
 * would only show under load.
 *
 * Null when the group is full — the cap is what bounds a card's size, since the
 * only other bound is how long the agent runs.
 */
export function addTake(
  card: Omit<WallItem, 'takes' | 'kind'>,
  take: Take,
  files: Files,
  group: { label?: string; of?: number },
): { item: WallItem; poster: Poster; opened: boolean } | null {
  const held = entries.get(card.id)
  if (held && (held.item.takes?.length ?? 0) >= MAX_TAKES) return null

  const entry: Entry =
    held ??
    ({
      item: { ...card, kind: 'group', takes: [], ...(Object.keys(group).length > 0 ? { group } : {}) },
      sourcePath: files.sourcePath,
      cachePath: files.cachePath,
      takes: new Map(),
    } satisfies Entry)

  // Kept in arrival order rather than ingest order: a restart re-adopts a
  // group's takes in whatever order the watcher offers them, and a carousel that
  // shuffles itself when the daemon bounces would be unreviewable.
  const takes = [...(entry.item.takes ?? []), take]
  takes.sort((a, b) => a.at - b.at)
  entry.item.takes = takes
  entry.takes.set(take.id, files)
  takeOwner.set(take.id, entry.item.id)
  // A group may learn its total late — the first send need not know it — and a
  // later label is the sender correcting itself, not a second group.
  if (group.of !== undefined || group.label !== undefined) {
    entry.item.group = { ...entry.item.group, ...group }
  }
  // A take arriving means the group is still producing, so the card is not stale.
  // A mended take comes back at its old `at`, which must not age the card.
  if (held) entry.item.bornAt = Math.max(entry.item.bornAt, take.at)
  entries.set(entry.item.id, entry)
  return { item: entry.item, poster: repost(entry), opened: !held }
}

export function snapshot(): WallItem[] {
  return [...entries.values()].map((e) => e.item)
}

/**
 * Drop whatever this path was holding, because the file is no longer there.
 *
 * The wall's own expiry moves the file and drops the item first, so by the time
 * the watcher reports it there is nothing left to match and this does nothing.
 * It is for a deletion from outside — a directory removed, a file cleaned up by
 * something that never heard of the wall — which otherwise left a card whose
 * lightbox served a 404 for as long as the daemon ran.
 *
 * A group loses only the take: the card stands while any take still has a file,
 * and `emptied` is false.
 */
export function forget(sourcePath: string): { id: string; emptied: boolean } | null {
  const gone = release(sourcePath)
  if (gone?.emptied) for (const fn of listeners) fn(gone.id)
  return gone
}

/**
 * Takes a path off the wall without announcing it, for a mend that ingests it
 * again under the same id. `at` is when it landed — the card's `bornAt`, or the
 * take's own — so it can come back at the same age. `emptied` says the card went
 * with it rather than only a take.
 */
export function release(sourcePath: string): { id: string; at: number; emptied: boolean } | null {
  for (const entry of entries.values()) {
    if (entry.takes.size > 0) {
      for (const [takeId, files] of entry.takes.entries()) {
        if (files.sourcePath !== sourcePath) continue
        const at = entry.item.takes?.find((t) => t.id === takeId)?.at ?? entry.item.bornAt
        entry.takes.delete(takeId)
        takeOwner.delete(takeId)
        entry.item.takes = (entry.item.takes ?? []).filter((t) => t.id !== takeId)
        if (entry.takes.size > 0) {
          repost(entry)
          return { id: entry.item.id, at, emptied: false }
        }
        entries.delete(entry.item.id)
        return { id: entry.item.id, at, emptied: true }
      }
      continue
    }
    if (entry.sourcePath !== sourcePath) continue
    entries.delete(entry.item.id)
    return { id: entry.item.id, at: entry.item.bornAt, emptied: true }
  }
  return null
}

/**
 * One take of a group sent to the trash, leaving the rest of the card standing.
 * Null when the path is not a take with others beside it: a card, or a group's
 * last take, is expired whole, so that Delete's undo can bring it back.
 * A take pulled on its own is not an undo step.
 */
export async function expireTake(sourcePath: string): Promise<WallItem | null> {
  const owner = [...entries.values()].find(
    (e) => e.takes.size > 1 && [...e.takes.values()].some((f) => f.sourcePath === sourcePath),
  )
  if (!owner) return null
  const [takeId, files] = [...owner.takes.entries()].find(([, f]) => f.sourcePath === sourcePath)!
  // Somebody may be blocked in `transom ask` on it: they hear it expired.
  await closeTake(owner, takeId, 'expired', '')
  release(sourcePath)
  await mkdir(config.trash, { recursive: true })
  const dest = join(config.trash, `${takeId}-${owner.item.zone}`)
  await rename(sourcePath, dest).catch(() => {})
  await trashStamp(sourcePath, dest)
  if (files.marks?.status === 'pending' && files.marks.sender) await syncWaiting(files.marks.sender.session)
  return owner.item
}

/** The card a path's card id names, for a caller that needs the whole item. */
export const itemOf = (id: string): WallItem | undefined => entries.get(id)?.item

/**
 * Rescues an item, or lets one go again. The sidecar carries it, so the rescue
 * survives a restart; `keptAt` freezes the item's decay where it stood.
 *
 * At `KEEP_CAP` a rescue must name the kept item it `replace`s, which is let go
 * first; without one it is refused as `full`.
 */
export async function keep(
  id: string,
  on: boolean,
  replace?: string,
): Promise<{ keptAt: number | null; released?: string } | 'full' | false> {
  const entry = entries.get(id)
  if (!entry) return false
  let released: string | undefined
  if (on && entry.item.keptAt === undefined) {
    if (keptOf([...entries.values()].map((e) => e.item)).length >= KEEP_CAP) {
      const out = replace === undefined ? undefined : entries.get(replace)
      if (out?.item.keptAt === undefined) return 'full'
      await setKeptOn(out, null)
      released = out.item.id
    }
  }
  const keptAt = await setKeptOn(entry, on ? Date.now() : null)
  return released === undefined ? { keptAt } : { keptAt, released }
}

async function setKeptOn(entry: Entry, keptAt: number | null): Promise<number | null> {
  if (keptAt === null) delete entry.item.keptAt
  else entry.item.keptAt = keptAt
  await setKept(entry.sourcePath, keptAt)
  return keptAt
}

/**
 * Clears an item's flag, on the wall and on disk. False when there was no such
 * item or it was not asking in the first place, so the caller does not
 * broadcast a change that did not happen.
 */
export async function dismiss(id: string, closeQuestion = false): Promise<boolean> {
  const entry = entries.get(id)
  // Opening a card dismisses its flag, and must not answer for the viewer.
  if (entry && isOpen(entry.item)) return closeQuestion && (await closeAll(entry, 'dismissed'))
  if (!entry?.item.attention) return false
  delete entry.item.attention
  await clearAttention(entry.sourcePath)
  return true
}

/** The reply a question closed with, for the caller to broadcast. A group's
 *  replies are its takes'. */
export const replyOf = (id: string, takeId?: string) => {
  const item = entries.get(id)?.item
  if (takeId === undefined) return item?.reply
  return item?.takes?.find((t) => t.id === takeId)?.reply
}

/** The poster a group is drawing, for a caller that has to broadcast it. */
export const posterAt = (id: string): Poster | null => {
  const item = entries.get(id)?.item
  return item?.kind === 'group' ? posterOf(item.takes ?? []) : null
}

/** False when there is no such item or no open question on it. A group answers
 *  one take at a time, which is what `takeId` names. */
export async function answer(
  id: string,
  status: Closed,
  text: string,
  choice?: string,
  takeId?: string,
): Promise<boolean> {
  const entry = entries.get(id)
  if (!entry) return false
  if (takeId !== undefined) return (await closeTake(entry, takeId, status, text, choice)) !== null
  return close(entry, status, text, choice)
}

/** The item or take a take id belongs to. A group's takes are addressed by their
 *  own ids, so `/img/<takeId>` and the open route resolve without a scan. */
export function takeAt(takeId: string): { item: WallItem; take: Take } | null {
  const owner = takeOwner.get(takeId)
  const item = owner === undefined ? undefined : entries.get(owner)?.item
  const take = item?.takes?.find((t) => t.id === takeId)
  return item && take ? { item, take } : null
}

/** The apps offered for an id, whether it names a card or one take of a group.
 *  Empty for anything that offered none, which is most of the wall. */
export const appsAt = (id: string) =>
  takeAt(id)?.take.apps ?? entries.get(id)?.item.apps ?? []

const filesAt = (id: string): Files | undefined => {
  const entry = entries.get(id)
  if (entry) return entry
  const owner = takeOwner.get(id)
  return owner === undefined ? undefined : entries.get(owner)?.takes.get(id)
}

export function pathOf(id: string) {
  return filesAt(id)?.sourcePath
}

export function resolveCache(id: string) {
  return filesAt(id)?.cachePath
}

export function resolveOriginal(id: string) {
  return filesAt(id)?.sourcePath
}
