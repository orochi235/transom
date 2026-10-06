import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { config } from './config.ts'
import { save } from './atomic.ts'
import type { Markup } from '@shared/protocol.ts'

/**
 * A drawing sent back from the lightbox, on disk.
 *
 * `marks/<artifact id>.png` is the composite and `marks/<artifact id>.json`
 * the record: the status, the text, the marks themselves and who they are for.
 * One per artifact — drawing again replaces it. Beside the answers and the
 * pins rather than beside the image, because the composite's path is what the
 * sender is handed and has to stay put while the card does; expiry moves both
 * into the trash with the card, the way it moves the sidecar.
 *
 * `marks/waiting/<session>` exists while any pending record is for that
 * session. The hook stats it on every tool call, so a session with nothing
 * waiting costs one `stat` rather than a request to the daemon.
 */

/** Who sent an artifact: the Claude Code session and its process, as
 *  `bin/transom` saw them in its environment. */
export type Sender = { session: string; pid?: number; host?: string }

/** How recently a session on another host must have asked for its marks to
 *  count as running. Its hook asks on every tool call, so two minutes of
 *  silence is a session that has stopped. */
export const REMOTE_LIVE_MS = 120_000
const lastSeen = new Map<string, number>()

export function sawSession(session: string, now = Date.now()) {
  lastSeen.set(session, now)
}

export type MarkRecord = {
  status: Markup['status']
  text: string
  at: number
  resolvedAt?: number
  via?: Markup['via']
  /** labkit's serialized marks, kept so a drawing is data and not only pixels. */
  marks: unknown
  sender?: Sender
  /** The card it is on, and the take when that card is a group. */
  card: string
  take?: string
  caption: string
}

export const marksDir = () => config.marks
export const pngOf = (id: string) => join(config.marks, `${id}.png`)
const jsonOf = (id: string) => join(config.marks, `${id}.json`)
const waitingOf = (session: string) => join(config.marks, 'waiting', safe(session))
/** A session id is a UUID, but it names a file here, so nothing else passes. */
const safe = (session: string) => session.replace(/[^A-Za-z0-9._-]/g, '_')

export async function write(id: string, record: MarkRecord, png?: Buffer): Promise<void> {
  await mkdir(config.marks, { recursive: true })
  if (png) {
    await writeFile(`${pngOf(id)}.tmp`, png)
    await rename(`${pngOf(id)}.tmp`, pngOf(id))
  }
  await save(jsonOf(id), `${JSON.stringify(record)}\n`)
}

export async function read(id: string): Promise<MarkRecord | null> {
  try {
    const blob = JSON.parse(await readFile(jsonOf(id), 'utf8')) as MarkRecord
    return typeof blob?.status === 'string' ? blob : null
  } catch {
    return null
  }
}

/** The files a record occupies, for an expiry to move and an undo to put back. */
export const filesOf = (id: string) => [jsonOf(id), pngOf(id)]

/** Marks whether a session has anything waiting, for the hook's cheap check. */
export async function flagWaiting(session: string, waiting: boolean): Promise<void> {
  if (!waiting) return void (await rm(waitingOf(session), { force: true }).catch(() => {}))
  await mkdir(join(config.marks, 'waiting'), { recursive: true })
  await writeFile(waitingOf(session), '')
}

/**
 * Whether the session that sent an artifact is still running: its pid is
 * alive and is still a claude process, since a pid is reused once it exits.
 * No pid recorded is not live — nothing can be said about it.
 */
export async function isLive(sender: Sender | undefined, now = Date.now()): Promise<boolean> {
  if (sender?.host) {
    const seen = lastSeen.get(sender.session)
    return seen !== undefined && now - seen < REMOTE_LIVE_MS
  }
  const pid = sender?.pid
  if (!pid || !Number.isInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
  } catch (err) {
    // EPERM is a process that exists and belongs to someone else.
    if ((err as NodeJS.ErrnoException).code !== 'EPERM') return false
  }
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'args=', '-p', String(pid)], (err, out) => {
      resolve(!err && looksLikeClaude(out))
    })
  })
}

/** Whether a command line is Claude Code's: the `claude` binary, or node
 *  running the package. By word, not substring — a checkout under `.claude/`
 *  puts that string in every path a test or a daemon runs from. */
export function looksLikeClaude(args: string): boolean {
  return args
    .trim()
    .split(/\s+/)
    .some((word) => basename(word) === 'claude' || word.includes('@anthropic-ai/claude-code'))
}

/** What the wall is told about a record. */
export const view = (id: string, record: MarkRecord, live: boolean): Markup => ({
  status: record.status,
  text: record.text,
  at: record.at,
  ...(record.resolvedAt === undefined ? {} : { resolvedAt: record.resolvedAt }),
  ...(record.via === undefined ? {} : { via: record.via }),
  url: `/api/marks/${id}.png`,
  live,
})
