import { mkdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { config } from '../config.ts'
import * as store from '../store.ts'
import type { Poster, Take, WallItem } from '@shared/protocol.ts'
import { ttlFromName } from '../ttlSuffix.ts'
import { captionFor } from '../captionName.ts'
import { idFor, origUrlFor, groupIdFor } from '../itemId.ts'
import { kindOf } from '../kind.ts'
import { keptFrom, readStamp, replyFrom } from '../sidecar.ts'
import * as marks from '../markup.ts'
import { parseAttention } from '@shared/attention.ts'
import { MAX_TAKES } from '@shared/groups.ts'
import { buildXmp, type Stamp } from '../xmp.ts'
import { render } from './render.ts'
import { stampOriginal } from './stampOriginal.ts'

/**
 * What landing produced: a card of its own, or a take appended to a group — in
 * which case the wall needs the take and the poster it moved the card to, and
 * `opened` says whether this was the group's first, since a group alerts once.
 */
export type Landed =
  | { as: 'card'; item: WallItem }
  | { as: 'take'; item: WallItem; take: Take; poster: Poster; opened: boolean }

export async function ingest(sourcePath: string, bornAt: number): Promise<Landed | null> {
  const kind = kindOf(sourcePath)
  if (kind === null) return null
  if (store.has(sourcePath)) return null

  const id = idFor(sourcePath)
  const cachePath = join(config.cache, `${id}.webp`)
  await mkdir(config.cache, { recursive: true })

  const zone = basename(dirname(sourcePath))
  const sidecar = await readStamp(sourcePath)
  const caption = captionFor(basename(sourcePath), sidecar)
  const xmp = buildXmp({ ...sidecar, zone, caption } satisfies Stamp)

  const rendered = await render(kind, sourcePath, id, cachePath, xmp)
  if (rendered === null) return null
  const { info, source, frames, duration, bytes } = rendered

  await stampOriginal(sourcePath, xmp)
  // `/img` is cached as immutable, so a mended file must arrive at a new URL.
  // ctime moves on every write and every `utimes`, which a sender cannot undo.
  const rev = await stat(sourcePath).then((s) => `?v=${Math.round(s.ctimeMs).toString(36)}`, () => '')

  const ttlMs = ttlFromName(basename(sourcePath))
  const question = sidecar?.question ?? null
  const asked = sidecar?.attention ? parseAttention(sidecar.attention) : null
  if (sidecar?.attention && !asked) {
    console.warn(`[ingest] unreadable attention "${sidecar.attention}" on ${basename(sourcePath)}`)
  }
  const reply = question === null ? null : replyFrom(sidecar)
  // Someone is waiting on an open question, so it always asks to be looked at.
  // A closed one asks for nothing.
  const attention = reply !== null ? null : (asked ?? (question === null ? null : parseAttention('look')))
  const note = sidecar?.note ?? question
  const keptAt = keptFrom(sidecar)
  const sender = sidecar?.session
    ? { session: sidecar.session, ...(sidecar.pid ? { pid: sidecar.pid } : {}), ...(sidecar.host ? { host: sidecar.host } : {}) }
    : undefined
  // A drawing sent back before a restart is still on the card after it.
  const drawn = await marks.read(id)
  const markup = drawn ? marks.view(id, drawn, drawn.status === 'pending' && (await marks.isLive(sender))) : null
  const own = { ...(sender ? { sender } : {}), ...(drawn ? { marks: drawn } : {}) }
  if (drawn?.status === 'pending' && drawn.sender) await marks.flagWaiting(drawn.sender.session, true)

  // A file naming a group is a take: it joins that group's card rather than
  // standing up one of its own. Everything above this is the picture pipeline
  // unchanged, which is the point — a take is a picture with a question on it.
  if (sidecar?.group) {
    const take: Take = {
      id,
      url: `/img/${id}${rev}`,
      origUrl: `${origUrlFor(id, sourcePath)}${rev}`,
      name: caption,
      path: sourcePath,
      at: bornAt,
      w: source?.w ?? info.width,
      h: source?.h ?? info.height,
      ...(question === null ? {} : { question }),
      ...(question !== null && sidecar.choices ? { choices: sidecar.choices } : {}),
      ...(question !== null && sidecar.why ? { why: sidecar.why } : {}),
      ...(reply === null ? {} : { reply }),
      ...(markup === null ? {} : { markup }),
      ...(sidecar.apps ? { apps: sidecar.apps } : {}),
      ...(sidecar.links ? { links: sidecar.links } : {}),
    }
    const landed = store.addTake(
      {
        id: groupIdFor(zone, sidecar.group),
        ...(ttlMs === null ? {} : { ttlMs }),
        ...(keptAt === null ? {} : { keptAt }),
        ...(attention === null ? {} : { attention }),
        ...(attention !== null && note ? { note } : {}),
        ...(sidecar.repo ? { repo: sidecar.repo } : {}),
        ...(sidecar.sha ? { sha: sidecar.sha } : {}),
        ...(sidecar.host ? { host: sidecar.host } : {}),
        ...(sidecar.quiet ? { quiet: true as const } : {}),
        // Overwritten by the poster the store picks; a group's card has no
        // pixels of its own, only whichever take it is drawing.
        url: take.url,
        origUrl: take.origUrl,
        path: sourcePath,
        zone,
        name: sidecar.groupLabel ?? sidecar.group,
        bornAt,
        w: take.w,
        h: take.h,
      },
      take,
      { sourcePath, cachePath, ...own },
      {
        ...(sidecar.groupLabel ? { label: sidecar.groupLabel } : {}),
        ...(sidecar.of === undefined ? {} : { of: sidecar.of }),
      },
    )
    if (!landed) {
      console.warn(
        `[ingest] group "${sidecar.group}" is full at ${MAX_TAKES} takes: ${basename(sourcePath)} stays in the inbox`,
      )
      return null
    }
    return { as: 'take', take, ...landed }
  }

  const item: WallItem = {
    id,
    ...(ttlMs === null ? {} : { ttlMs }),
    ...(keptAt === null ? {} : { keptAt }),
    ...(attention === null ? {} : { attention }),
    // A note without a flag has nothing to hang on, so it is dropped with it.
    ...(attention !== null && note ? { note } : {}),
    ...(question === null ? {} : { question }),
    ...(question !== null && sidecar?.choices ? { choices: sidecar.choices } : {}),
    ...(reply === null ? {} : { reply }),
    ...(markup === null ? {} : { markup }),
    ...(sidecar?.repo ? { repo: sidecar.repo } : {}),
    ...(sidecar?.sha ? { sha: sidecar.sha } : {}),
    ...(sidecar?.host ? { host: sidecar.host } : {}),
    ...(sidecar?.quiet ? { quiet: true as const } : {}),
    ...(kind === 'image' ? {} : { kind }),
    ...(frames === null ? {} : { frames }),
    ...(duration === null ? {} : { duration }),
    ...(bytes === null ? {} : { bytes }),
    ...(kind === 'page' && sidecar?.sandbox ? { sandbox: sidecar.sandbox } : {}),
    ...(sidecar?.apps ? { apps: sidecar.apps } : {}),
    ...(sidecar?.links ? { links: sidecar.links } : {}),
    url: `/img/${id}${rev}`,
    origUrl: `${origUrlFor(id, sourcePath)}${rev}`,
    path: sourcePath,
    zone,
    name: caption,
    bornAt,
    // The picture's size, not the thumbnail's — the meta line reports this
    // over an `/orig` that was never resized. Falls back to the cache's own
    // dimensions for a file sharp could measure only after decoding it.
    w: source?.w ?? info.width,
    h: source?.h ?? info.height,
  }
  store.add({ item, sourcePath, cachePath, ...own })
  return { as: 'card', item }
}
