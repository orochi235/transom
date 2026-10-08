import { rename, mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { config } from '../config.ts'
import { closeQuestion } from '../sidecar.ts'
import type { Poster, Reply } from '@shared/protocol.ts'
import { groupIsOpen, takeIsOpen } from '@shared/groups.ts'
import { isOpen, repost, type Entry } from './entries.ts'

export type Closed = Reply['status']

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
export async function close(
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
export async function closeTake(
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
export async function closeAll(entry: Entry, status: Closed): Promise<boolean> {
  if (entry.item.kind !== 'group') return close(entry, status, '')
  let closed = false
  for (const take of entry.item.takes ?? []) {
    if (await closeTake(entry, take.id, status, '')) closed = true
  }
  return closed
}
