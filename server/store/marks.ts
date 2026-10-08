import { rm } from 'node:fs/promises'
import type { Markup, Poster, Reply, Take } from '@shared/protocol.ts'
import * as marks from '../markup.ts'
import type { MarkRecord } from '../markup.ts'
import { takeIsOpen } from '@shared/groups.ts'
import { artifactsOf, entries, isOpen, takeOwner, type Entry, type Files } from './entries.ts'
import { close, closeTake } from './questions.ts'

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
export async function syncWaiting(session: string): Promise<void> {
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
