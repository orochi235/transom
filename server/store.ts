import { rename, mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { config } from './config.ts'
import { clearAttention, closeQuestion, setKept, trashStamp } from './sidecar.ts'
import { ttlMs as wallTtlMs } from './settings.ts'
import { lifetimeFor as zoneLifetime } from './zones.ts'
import type { Markup, Poster, Reply, Take, WallItem } from '@shared/protocol.ts'
import * as marks from './markup.ts'
import type { MarkRecord, Sender } from './markup.ts'
import { isEternal, lifetimeMs } from '@shared/lifetime.ts'
import { MAX_TAKES, posterOf, posterTake, groupIsOpen, takeIsOpen } from '@shared/groups.ts'

/** One artifact's files: the original the sender wrote and the thumbnail the
 *  daemon made of it. A group has a pair per take. `sender` is the session that
 *  sent it, where `bin/transom` saw one, and `marks` the drawing sent back. */
type Files = { sourcePath: string; cachePath: string; sender?: Sender; marks?: MarkRecord }

/**
 * A group's own `sourcePath`/`cachePath` mirror whichever take it is drawing, so
 * `/img/:id` and `/orig/:id` keep serving the card with no route of their own.
 * `takes` is empty for everything else.
 */
type Entry = Files & { item: WallItem; takes: Map<string, Files> }

const entries = new Map<string, Entry>()
/** Which group each take belongs to, so `/img/<takeId>` resolves in one lookup
 *  rather than a scan of every group on the wall. */
const takeOwner = new Map<string, string>()
const listeners = new Set<(id: string) => void>()

export function add(entry: { item: WallItem } & Files) {
  entries.set(entry.item.id, { ...entry, takes: new Map() })
}

const filesOf = (entry: Entry): Files[] => artifactsOf(entry).map(([, files]) => files)

/** Each artifact the card holds, by its own id: the card itself, or a group's
 *  takes. A group's own fields mirror whichever take it is drawing, so they are
 *  never read as an artifact of their own. */
const artifactsOf = (entry: Entry): [string, Files][] =>
  entry.takes.size > 0 ? [...entry.takes.entries()] : [[entry.item.id, entry]]

/** A drawing its sender has not got holds the whole card: the group is the unit
 *  of lifetime, as it is for an open question. */
const holdsMarks = (entry: Entry) => artifactsOf(entry).some(([, f]) => f.marks?.status === 'pending')

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

/**
 * Points the card at the take it should be drawing. Every path that can change
 * which one that is goes through here — a take arriving, a question closing —
 * so the rule lives in `posterOf` and nothing else holds a copy of it.
 */
function repost(entry: Entry): Poster {
  const take = posterTake(entry.item.takes ?? [])
  if (!take) throw new Error(`group ${entry.item.id} has no takes`)
  Object.assign(entry.item, posterOf(entry.item.takes ?? []))
  const files = entry.takes.get(take.id)
  if (files) Object.assign(entry, files)
  return { url: take.url, origUrl: take.origUrl, w: take.w, h: take.h }
}

export function snapshot(): WallItem[] {
  return [...entries.values()].map((e) => e.item)
}

/** Whether a card may be evicted for space: not pinned, not asked, not marked,
 *  not in an eternal zone. */
const mayEvict = (e: Entry): boolean =>
  !e.item.keptAt && !isOpen(e.item) && !holdsMarks(e) && !isEternal(zoneLifetime(e.item.zone))

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
      if (entry.item.keptAt || isOpen(entry.item) || holdsMarks(entry)) continue
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

export type Closed = Reply['status']

/** A group is open while any take is: the group is the unit of lifetime, so one
 *  unanswered take holds the whole card off the clock. */
const isOpen = (item: WallItem) =>
  item.kind === 'group' ? groupIsOpen(item) : item.question !== undefined && item.reply === undefined

/**
 * The answer file, which is what `transom ask` is waiting on. Three parts:
 * the status, then the chip, then the free text from line 3 on. `bin/transom` is
 * `sh` and has no JSON parser, and a blank line 2 is what tells it a free-text
 * answer's first line is not a choice.
 */
async function writeAnswer(sourcePath: string, reply: Reply, image?: string): Promise<void> {
  await mkdir(config.answers, { recursive: true })
  const dest = join(config.answers, basename(sourcePath))
  // Renamed into place, so the waiting reader never sees half a file. A
  // drawing has no chip, so its second line is the composite's path instead.
  await writeFile(`${dest}.tmp`, `${reply.status}\n${reply.choice ?? image ?? ''}\n${reply.text}`)
  await rename(`${dest}.tmp`, dest)
}

const replyAt = (status: Closed, choice: string | undefined, text: string): Reply => ({
  status,
  ...(choice ? { choice } : {}),
  text,
  at: Date.now(),
})

/**
 * Ends a question: the answer file first, since something is waiting on it,
 * then the flag and the sidecar. The question itself stays.
 */
async function close(
  entry: Entry,
  status: Closed,
  text: string,
  choice?: string,
  image?: string,
): Promise<boolean> {
  if (!isOpen(entry.item)) return false
  const reply = replyAt(status, choice, text)
  entry.item.reply = reply
  delete entry.item.attention
  await writeAnswer(entry.sourcePath, reply, image)
  await closeQuestion(entry.sourcePath, reply)
  return true
}

/** Ends one take's question, and moves the card on to the next take waiting.
 *  Null when there is no such take or it is already closed. */
async function closeTake(
  entry: Entry,
  takeId: string,
  status: Closed,
  text: string,
  choice?: string,
  image?: string,
): Promise<Poster | null> {
  const take = (entry.item.takes ?? []).find((t) => t.id === takeId)
  const files = entry.takes.get(takeId)
  if (!take || !files || !takeIsOpen(take)) return null
  const reply = replyAt(status, choice, text)
  take.reply = reply
  await writeAnswer(files.sourcePath, reply, image)
  await closeQuestion(files.sourcePath, reply)
  // A group stops asking once nothing in it is waiting.
  if (!groupIsOpen(entry.item)) delete entry.item.attention
  return repost(entry)
}

/** Every open question on the card at once: what a card-level dismiss and an
 *  expiry both mean for a group. */
async function closeAll(entry: Entry, status: Closed): Promise<boolean> {
  if (entry.item.kind !== 'group') return close(entry, status, '')
  let closed = false
  for (const take of entry.item.takes ?? []) {
    if (await closeTake(entry, take.id, status, '')) closed = true
  }
  return closed
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

/** A card or a take, by its own id, with the entry that holds it. */
function locate(id: string): { entry: Entry; files: Files; take?: Take } | null {
  const entry = entries.get(id)
  // A group's card is not an artifact: its drawings are on its takes.
  if (entry) return entry.takes.size > 0 ? null : { entry, files: entry }
  const owner = takeOwner.get(id)
  const group = owner === undefined ? undefined : entries.get(owner)
  const files = group?.takes.get(id)
  const take = group?.item.takes?.find((t) => t.id === id)
  return group && files && take ? { entry: group, files, take } : null
}

/** What the wall is told about a drawing: which card, which take, and its
 *  state now. */
export type MarkNews = { id: string; take?: string; markup: Markup; reply?: Reply; poster?: Poster }

function show(id: string, where: { entry: Entry; take?: Take }, markup: Markup): MarkNews {
  if (where.take) where.take.markup = markup
  else where.entry.item.markup = markup
  return { id: where.entry.item.id, ...(where.take ? { take: where.take.id } : {}), markup }
}

/** Keeps the hook's flag for a session true exactly while something waits. */
async function syncWaiting(session: string): Promise<void> {
  let waiting = false
  for (const entry of entries.values()) {
    for (const [, f] of artifactsOf(entry)) {
      if (f.marks?.status === 'pending' && f.marks.sender?.session === session) waiting = true
    }
  }
  await marks.flagWaiting(session, waiting)
}

/**
 * Holds a drawing sent back from the lightbox, and hands it on where it can
 * go at once.
 *
 * A question still open, from a sender that is running or that recorded no
 * session at all, is answered by it: that is the `transom ask` blocked on the
 * card, and the reply is the fastest way back. Anything else stays pending on
 * the card, flagged for the hook to collect at the sender's next tool call —
 * or for nobody, if the sender has gone, until the wall discards it.
 */
export async function markUp(
  id: string,
  drawn: { png: Buffer; marks: unknown; text: string },
): Promise<MarkNews | null> {
  const where = locate(id)
  if (!where) return null
  const { entry, files, take } = where
  const sender = files.sender
  const previous = files.marks
  const record: MarkRecord = {
    status: 'pending',
    text: drawn.text,
    at: Date.now(),
    marks: drawn.marks,
    ...(sender ? { sender } : {}),
    card: entry.item.id,
    ...(take ? { take: take.id } : {}),
    caption: take?.name ?? entry.item.name,
  }
  await marks.write(id, record, drawn.png)
  files.marks = record
  const live = await marks.isLive(sender)
  const asking = take ? takeIsOpen(take) : isOpen(entry.item)
  let reply: Reply | undefined
  let poster: Poster | undefined
  if (asking && (live || !sender)) {
    const image = marks.pngOf(id)
    if (take) poster = (await closeTake(entry, take.id, 'marked', drawn.text, undefined, image)) ?? undefined
    else await close(entry, 'marked', drawn.text, undefined, image)
    reply = take ? take.reply : entry.item.reply
    Object.assign(record, { status: 'delivered', via: 'ask', resolvedAt: Date.now() } satisfies Partial<MarkRecord>)
    await marks.write(id, record)
  }
  if (sender) await syncWaiting(sender.session)
  if (previous?.sender && previous.sender.session !== sender?.session) await syncWaiting(previous.sender.session)
  return {
    ...show(id, where, marks.view(id, record, live)),
    ...(reply ? { reply } : {}),
    ...(poster ? { poster } : {}),
  }
}

/** Throws a pending drawing away on purpose. Its composite goes; the record
 *  stays with the card, which ages again from now. */
export async function discardMarks(id: string): Promise<MarkNews | null> {
  const where = locate(id)
  const record = where?.files.marks
  if (!where || record?.status !== 'pending') return null
  record.status = 'discarded'
  record.resolvedAt = Date.now()
  await marks.write(id, record)
  await rm(marks.pngOf(id), { force: true })
  if (record.sender) await syncWaiting(record.sender.session)
  return show(id, where, marks.view(id, record, false))
}

/** What the hook hands a session: every drawing waiting for it, each marked
 *  delivered as it goes. */
export type Claimed = { id: string; caption: string; zone: string; image: string; text: string }

export async function claimMarks(session: string): Promise<{ claimed: Claimed[]; news: MarkNews[] }> {
  const claimed: Claimed[] = []
  const news: MarkNews[] = []
  for (const entry of entries.values()) {
    for (const [id, files] of artifactsOf(entry)) {
      const record = files.marks
      if (record?.status !== 'pending' || record.sender?.session !== session) continue
      Object.assign(record, { status: 'delivered', via: 'hook', resolvedAt: Date.now() } satisfies Partial<MarkRecord>)
      await marks.write(id, record)
      claimed.push({ id, caption: record.caption, zone: entry.item.zone, image: marks.pngOf(id), text: record.text })
      const take = entry.takes.size > 0 ? entry.item.takes?.find((t) => t.id === id) : undefined
      news.push(show(id, { entry, ...(take ? { take } : {}) }, marks.view(id, record, true)))
    }
  }
  await marks.flagWaiting(session, false)
  return { claimed, news }
}

/** Looks again at whether each pending drawing's sender is running, and
 *  reports the ones that changed — a session that exits turns its drawings
 *  from waiting into held. */
export async function recheckSenders(): Promise<MarkNews[]> {
  const news: MarkNews[] = []
  for (const entry of entries.values()) {
    for (const [id, files] of artifactsOf(entry)) {
      const record = files.marks
      if (record?.status !== 'pending') continue
      const take = entry.takes.size > 0 ? entry.item.takes?.find((t) => t.id === id) : undefined
      const shown = take ? take.markup : entry.item.markup
      const live = await marks.isLive(record.sender)
      if (shown?.live === live) continue
      news.push(show(id, { entry, ...(take ? { take } : {}) }, marks.view(id, record, live)))
    }
  }
  return news
}
