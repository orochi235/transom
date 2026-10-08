import type { Poster, WallItem } from '@shared/protocol.ts'
import type { MarkRecord, Sender } from '../markup.ts'
import { posterOf, posterTake, groupIsOpen } from '@shared/groups.ts'

/** One artifact's files: the original the sender wrote and the thumbnail the
 *  daemon made of it. A group has a pair per take. `sender` is the session that
 *  sent it, where `bin/transom` saw one, and `marks` the drawing sent back. */
export type Files = { sourcePath: string; cachePath: string; sender?: Sender; marks?: MarkRecord }

/**
 * A group's own `sourcePath`/`cachePath` mirror whichever take it is drawing, so
 * `/img/:id` and `/orig/:id` keep serving the card with no route of their own.
 * `takes` is empty for everything else.
 */
export type Entry = Files & { item: WallItem; takes: Map<string, Files> }

export const entries = new Map<string, Entry>()
/** Which group each take belongs to, so `/img/<takeId>` resolves in one lookup
 *  rather than a scan of every group on the wall. */
export const takeOwner = new Map<string, string>()
export const listeners = new Set<(id: string) => void>()

export const filesOf = (entry: Entry): Files[] => artifactsOf(entry).map(([, files]) => files)

/** Each artifact the card holds, by its own id: the card itself, or a group's
 *  takes. A group's own fields mirror whichever take it is drawing, so they are
 *  never read as an artifact of their own. */
export const artifactsOf = (entry: Entry): [string, Files][] =>
  entry.takes.size > 0 ? [...entry.takes.entries()] : [[entry.item.id, entry]]

/** A drawing its sender has not got holds the whole card: the group is the unit
 *  of lifetime, as it is for an open question. */
const holdsMarks = (entry: Entry) => artifactsOf(entry).some(([, f]) => f.marks?.status === 'pending')

/**
 * Points the card at the take it should be drawing. Every path that can change
 * which one that is goes through here — a take arriving, a question closing —
 * so the rule lives in `posterOf` and nothing else holds a copy of it.
 */
export function repost(entry: Entry): Poster {
  const take = posterTake(entry.item.takes ?? [])
  if (!take) throw new Error(`group ${entry.item.id} has no takes`)
  Object.assign(entry.item, posterOf(entry.item.takes ?? []))
  const files = entry.takes.get(take.id)
  if (files) Object.assign(entry, files)
  return { url: take.url, origUrl: take.origUrl, w: take.w, h: take.h }
}

/** Pinned, asked, or holding undelivered marks: neither its lifetime nor the
 *  reaper may take it. */
export const isHeld = (e: Entry): boolean => !!e.item.keptAt || isOpen(e.item) || holdsMarks(e)

/** A group is open while any take is: the group is the unit of lifetime, so one
 *  unanswered take holds the whole card off the clock. */
export const isOpen = (item: WallItem) =>
  item.kind === 'group' ? groupIsOpen(item) : item.question !== undefined && item.reply === undefined
