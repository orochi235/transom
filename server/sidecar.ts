import { readFile, rename, writeFile } from 'node:fs/promises'
import type { Stamp } from './xmp.ts'
import type { Reply } from '@shared/protocol.ts'

/**
 * `<image>.transom.json`, written by `bin/transom` beside the image it describes.
 *
 * A sidecar rather than the filename, which is where the TTL rides: a caption
 * holds spaces and slashes, and the name is not durable anyway — expiry
 * renames a file to `<id>-<zone>`, dropping even its extension. `bin/transom`
 * writes the sidecar *before* the image, so the image's arrival — which is
 * what the watcher triggers on — proves the sidecar is already complete.
 */
export const sidecarFor = (imagePath: string) => `${imagePath}.transom.json`

/** Only the fields the wall knows, only where they are strings. A blob from
 *  an older or hand-edited sidecar loses what does not fit rather than
 *  reaching the wall as junk. */
export function parseStamp(blob: unknown): Stamp {
  if (blob === null || typeof blob !== 'object' || Array.isArray(blob)) return {}
  const held = blob as Record<string, unknown>
  const out: Stamp = {}
  for (const key of ['caption', 'zone', 'repo', 'sha', 'attention', 'note', 'kept', 'sandbox', 'reply', 'closed', 'closedAt', 'why', 'group', 'groupLabel', 'choice', 'session', 'host'] as const) {
    const value = held[key]
    if (typeof value === 'string' && value !== '') out[key] = value
  }
  // `run`/`runLabel` are the names v0.2.0 wrote, before the idea was a group.
  if (!out.group && typeof held.run === 'string' && held.run !== '') out.group = held.run
  if (!out.groupLabel && typeof held.runLabel === 'string' && held.runLabel !== '') out.groupLabel = held.runLabel
  if (typeof held.question === 'string' && held.question !== '') out.question = held.question
  if (Array.isArray(held.choices)) {
    const choices = held.choices.filter((c): c is string => typeof c === 'string' && c !== '')
    if (choices.length > 0) out.choices = choices
  }
  // A count of zero or a fraction says nothing a missing count does not, and
  // both would reach the badge as a total the group cannot reach.
  if (typeof held.of === 'number' && Number.isInteger(held.of) && held.of > 0) out.of = held.of
  if (typeof held.pid === 'number' && Number.isInteger(held.pid) && held.pid > 1) out.pid = held.pid
  const apps = pairs(held.apps, 'name', 'path')
  if (apps.length > 0) out.apps = apps as Stamp['apps']
  // Only what a browser will open. A `file:` link a page silently blocks is
  // exactly the artifact that wanted `--app`, and `javascript:` is not a link.
  const links = pairs(held.links, 'label', 'url').filter((l) => /^https?:\/\//i.test(l.url))
  if (links.length > 0) out.links = links as Stamp['links']
  if (held.quiet === true) out.quiet = true
  return out
}

/** The entries of an array of two-string records, dropping anything that is
 *  not one. A hand-edited sidecar loses the malformed entry, never the file. */
function pairs<A extends string, B extends string>(
  blob: unknown,
  a: A,
  b: B,
): Record<A | B, string>[] {
  if (!Array.isArray(blob)) return []
  return blob.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object') return []
    const held = entry as Record<string, unknown>
    const first = held[a]
    const second = held[b]
    if (typeof first !== 'string' || first === '') return []
    if (typeof second !== 'string' || second === '') return []
    return [{ [a]: first, [b]: second } as Record<A | B, string>]
  })
}

/**
 * The stamp beside an image, or null where there is no sidecar at all — which
 * is the common case, not an error: most files are dropped in by hand. The
 * distinction carries: a sidecar with no caption means the CLI had nothing to
 * say, and a UUID filename must not be read as one.
 */
export async function readStamp(imagePath: string): Promise<Stamp | null> {
  try {
    return parseStamp(JSON.parse(await readFile(sidecarFor(imagePath), 'utf8')))
  } catch {
    return null
  }
}

/**
 * Drops the attention token from an image's sidecar, so a dismissal survives a
 * daemon restart — `adopt` re-reads the sidecar off disk, and a flag left there
 * would come back the moment the daemon bounced.
 *
 * A missing sidecar is not an error: an item flagged by hand-editing has
 * nothing to clear, and the in-memory store has already forgotten the flag.
 */
export async function clearAttention(imagePath: string): Promise<void> {
  const path = sidecarFor(imagePath)
  try {
    const blob = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    if (!('attention' in blob)) return
    delete blob.attention
    await writeFile(path, `${JSON.stringify(blob)}\n`)
  } catch {
    // Nothing to clear, or a sidecar this build cannot read. Either way the
    // dismissal already happened in the store, which is what the wall shows.
  }
}

/** Records how a question closed and drops its flag, so a restart shows the
 *  reply rather than asking again. */
export async function closeQuestion(imagePath: string, reply: Reply): Promise<void> {
  const path = sidecarFor(imagePath)
  try {
    const blob = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    delete blob.attention
    blob.closed = reply.status
    blob.closedAt = new Date(reply.at).toISOString()
    if (reply.choice) blob.choice = reply.choice
    if (reply.text) blob.reply = reply.text
    await writeFile(path, `${JSON.stringify(blob)}\n`)
  } catch {
    // No sidecar is no question on disk to close.
  }
}

/** The reply a closed question carries, or null while it is open. */
export function replyFrom(stamp: Stamp | null): Reply | null {
  const status = stamp?.closed
  if (status !== 'answered' && status !== 'dismissed' && status !== 'expired' && status !== 'marked') return null
  const at = Date.parse(stamp?.closedAt ?? '')
  return {
    status,
    ...(stamp?.choice ? { choice: stamp.choice } : {}),
    text: stamp?.reply ?? '',
    at: Number.isNaN(at) ? 0 : at,
  }
}

/**
 * Writes the rescue into the sidecar, or takes it back out. Nothing else
 * survives a daemon restart: `adopt` re-reads the sidecar off disk, so a keep
 * held only in memory would let a rescued file expire on the next bounce.
 *
 * Written as an ISO string because the sidecar is a file people read and
 * hand-edit; `readKept` takes it back to a number.
 */
export async function setKept(imagePath: string, keptAt: number | null): Promise<void> {
  const path = sidecarFor(imagePath)
  let blob: Record<string, unknown> = {}
  try {
    blob = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch {
    // Most files arrive without one. A rescue is the wall's own record, so it
    // writes the sidecar the CLI never did rather than dropping the keep.
  }
  if (keptAt === null) delete blob.kept
  else blob.kept = new Date(keptAt).toISOString()
  await writeFile(path, `${JSON.stringify(blob)}\n`)
}

/** When an image was rescued, or null. Unparseable is null: a hand-edited
 *  date that means nothing must not freeze a file on the wall forever. */
export function keptFrom(stamp: Stamp | null): number | null {
  if (!stamp?.kept) return null
  const at = Date.parse(stamp.kept)
  return Number.isNaN(at) ? null : at
}

/** Follows its image into the trash. Left behind it would be an orphan the
 *  wall never looks at again. */
export async function trashStamp(imagePath: string, dest: string): Promise<void> {
  await rename(sidecarFor(imagePath), sidecarFor(dest)).catch(() => {})
}
