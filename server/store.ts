import { clearAttention, setKept } from './sidecar.ts'
import type { Poster, Take, WallItem } from '@shared/protocol.ts'
import { MAX_TAKES, posterOf } from '@shared/groups.ts'
import { entries, isOpen, listeners, repost, takeOwner, type Entry, type Files } from './store/entries.ts'
import { close, closeAll, closeTake, type Closed } from './store/questions.ts'

export type { Closed } from './store/questions.ts'
export { evictable, inUse, evict, onExpire, startSweeper, expireNow, expireZone, undoExpiry } from './store/expiry.ts'
export { markUp, discardMarks, claimMarks, recheckSenders, type MarkNews, type Claimed } from './store/marks.ts'

export function add(entry: { item: WallItem } & Files) {
  entries.set(entry.item.id, { ...entry, takes: new Map() })
}

export function has(sourcePath: string) {
  for (const e of entries.values()) {
    if (e.takes.size === 0) {
      if (e.sourcePath === sourcePath) return true
      continue
    }
    // A group's own sourcePath is a copy of a take's, so only the takes are
    // asked: the sweep must re-offer nothing, and must not skip a take either.
    for (const f of e.takes.values()) if (f.sourcePath === sourcePath) return true
  }
  return false
}

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
  if (held) entry.item.bornAt = take.at
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
 * A group loses only the take: the card stands while any take still has a file.
 */
export function forget(sourcePath: string): string | null {
  for (const entry of entries.values()) {
    if (entry.takes.size > 0) {
      for (const [takeId, files] of entry.takes.entries()) {
        if (files.sourcePath !== sourcePath) continue
        entry.takes.delete(takeId)
        takeOwner.delete(takeId)
        if (entry.takes.size > 0) return null
        entries.delete(entry.item.id)
        for (const fn of listeners) fn(entry.item.id)
        return entry.item.id
      }
      continue
    }
    if (entry.sourcePath !== sourcePath) continue
    entries.delete(entry.item.id)
    for (const fn of listeners) fn(entry.item.id)
    return entry.item.id
  }
  return null
}

/**
 * Rescues an item, or lets one go again. The sidecar carries it, so the rescue
 * survives a restart; `keptAt` freezes the item's decay where it stood.
 */
export async function keep(id: string, on: boolean): Promise<number | null | false> {
  const entry = entries.get(id)
  if (!entry) return false
  const keptAt = on ? Date.now() : null
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
