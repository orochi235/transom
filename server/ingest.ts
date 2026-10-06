import sharp, { type OutputInfo } from 'sharp'
import { mkdir, rm, stat, rename, utimes, writeFile } from 'node:fs/promises'
import { basename, dirname, join, extname } from 'node:path'
import { config } from './config.ts'
import * as store from './store.ts'
import type { Poster, Take, WallItem } from '@shared/protocol.ts'
import { ttlFromName } from './ttlSuffix.ts'
import { captionFor } from './captionName.ts'
import { idFor, origUrlFor, groupIdFor } from './itemId.ts'
import { kindOf } from './kind.ts'
import { keptFrom, readStamp, replyFrom } from './sidecar.ts'
import * as marks from './markup.ts'
import { ttlMs as wallTtlMs } from './settings.ts'
import { orientedSize } from './sourceSize.ts'
import { framesOf } from './frames.ts'
import { posterFor } from './poster.ts'
import { durationOf } from './probe.ts'
import { parseAttention } from '@shared/attention.ts'
import { MAX_TAKES } from '@shared/groups.ts'
import { buildXmp, type Stamp } from './xmp.ts'
import { createLimiter } from './limit.ts'
import { watchTree } from './watchTree.ts'
import { startSweep } from './inboxSweep.ts'

/**
 * The stamp into the file the wall hands out, which is the original — `/orig`
 * serves it, and expiry renames it to `<id>-<zone>` with no extension, so the
 * only provenance that survives either trip is the kind carried inside.
 *
 * PNG only, because writing metadata means re-encoding: lossless for a PNG,
 * and a silent quality loss for anything else. A JPEG keeps its bytes and
 * goes unstamped rather than being quietly degraded.
 */
export async function stampOriginal(sourcePath: string, xmp: string): Promise<void> {
  if (extname(sourcePath).toLowerCase() !== '.png') return
  try {
    const { atime, mtime } = await stat(sourcePath)
    // Through a buffer: sharp cannot read and write the same path.
    await writeFile(sourcePath, await sharp(sourcePath).withXmp(xmp).png().toBuffer())
    // `adopt` reads mtime so that a restart cannot resurrect the wall, so a
    // stamp that bumps it re-ages every item the daemon re-adopts.
    await utimes(sourcePath, atime, mtime)
  } catch (err) {
    console.warn(`[ingest] unstamped ${basename(sourcePath)}: ${(err as Error).message}`)
  }
}

/**
 * What landing produced: a card of its own, or a take appended to a group — in
 * which case the wall needs the take and the poster it moved the card to, and
 * `opened` says whether this was the group's first, since a group alerts once.
 */
export type Landed =
  | { as: 'card'; item: WallItem }
  | { as: 'take'; item: WallItem; take: Take; poster: Poster; opened: boolean }

async function ingest(sourcePath: string, bornAt: number): Promise<Landed | null> {
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

  let info: OutputInfo
  // The artifact's own size, read before the resize that produces `info`.
  // `info` describes the cache thumbnail, and `/orig` hands out the original.
  let source: { w: number; h: number } | null = null
  let frames: number | null = null
  // A page and a video have no still of their own, so each is given one.
  // Everything below this is the picture pipeline unchanged, which is the
  // point: nothing downstream of here learns either kind exists.
  const posterPath = join(config.cache, `${id}.poster.png`)
  const pixelPath = await posterFor(kind, sourcePath, posterPath)
  if (pixelPath === null) {
    // A poster that timed out may have left a half-written file behind.
    await rm(posterPath, { force: true }).catch(() => {})
    return null
  }
  // ffprobe is asked for this and nothing else: the size comes off the poster
  // below, because a phone's `.mov` carries a display matrix that ffmpeg
  // applies to the frame and ffprobe reports the stream without.
  const duration = kind === 'video' ? await durationOf(sourcePath) : null
  // A mesh reports how much of it there is the only way it can: the poster is
  // a square view of it and its pixel size is the viewport's, not the model's.
  const bytes = kind === 'mesh' ? ((await stat(sourcePath).catch(() => null))?.size ?? null) : null

  try {
    const meta = await sharp(pixelPath).metadata()
    source = orientedSize(meta)
    frames = framesOf(meta)
    info = await sharp(pixelPath)
      .rotate()
      .resize({
        width: config.maxEdge,
        height: config.maxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      // Written rather than kept: the stamp carries what the source file could
      // not know, starting with the zone it landed in.
      .withXmp(xmp)
      .webp({ quality: 82 })
      .toFile(cachePath)
  } catch (err) {
    console.warn(`[ingest] skipped ${basename(sourcePath)}: ${(err as Error).message}`)
    return null
  } finally {
    // The poster only ever fed the webp. Keeping it would double the cache for
    // every page and every video on the wall.
    if (pixelPath !== sourcePath) await rm(posterPath, { force: true }).catch(() => {})
  }

  await stampOriginal(sourcePath, xmp)

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
    ? { session: sidecar.session, ...(sidecar.pid ? { pid: sidecar.pid } : {}) }
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
      url: `/img/${id}`,
      origUrl: origUrlFor(id, sourcePath),
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
    ...(sidecar?.quiet ? { quiet: true as const } : {}),
    ...(kind === 'image' ? {} : { kind }),
    ...(frames === null ? {} : { frames }),
    ...(duration === null ? {} : { duration }),
    ...(bytes === null ? {} : { bytes }),
    ...(kind === 'page' && sidecar?.sandbox ? { sandbox: sidecar.sandbox } : {}),
    ...(sidecar?.apps ? { apps: sidecar.apps } : {}),
    ...(sidecar?.links ? { links: sidecar.links } : {}),
    url: `/img/${id}`,
    origUrl: origUrlFor(id, sourcePath),
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

/**
 * Files present at startup are adopted at their mtime, not "now" — a daemon
 * restart must not resurrect the wall or reset anything's decay. A rescued
 * file is adopted however old it is; that is what the rescue bought.
 */
async function adopt(sourcePath: string): Promise<Landed | null> {
  const { mtimeMs } = await stat(sourcePath)
  // Unsent marks hold a card the way a rescue does: nothing drops them unasked.
  const rescued =
    keptFrom(await readStamp(sourcePath)) !== null || (await marks.read(idFor(sourcePath)))?.status === 'pending'
  if (!rescued && Date.now() - mtimeMs > (ttlFromName(basename(sourcePath)) ?? wallTtlMs())) {
    await mkdir(config.trash, { recursive: true })
    await rename(sourcePath, join(config.trash, basename(sourcePath))).catch(() => {})
    return null
  }
  return ingest(sourcePath, mtimeMs)
}

export function watchInbox(onLand: (landed: Landed) => void) {
  // Capped because ingest is the daemon's only heavy work: a decode, a resize,
  // a webp encode and a full-resolution re-encode per file. Uncapped, a restart
  // with a full inbox starts all of them at once.
  const gate = createLimiter(config.ingestAtOnce)
  const inFlight = new Set<string>()
  // Offered, and ingest wanted nothing to do with it — a file sharp cannot
  // read. Without this the sweep re-offers it every tick until it ages out.
  const declined = new Set<string>()
  const held = (p: string) => store.has(p) || inFlight.has(p) || declined.has(p)

  const take = (sourcePath: string, adopting: boolean) => {
    // Several paths reach the same artifact on purpose: the watch, the
    // adopting scan, the sweep, and the events ingest's own stamp rewrite
    // fires. The store answers by source path, so the rest are dropped here.
    if (held(sourcePath)) return
    inFlight.add(sourcePath)
    // Read at arrival rather than when the turn comes: a file waiting behind
    // others must not be dated when it finally runs.
    const at = Date.now()
    void gate(async () => {
      try {
        const landed = adopting ? await adopt(sourcePath) : await ingest(sourcePath, at)
        if (landed) onLand(landed)
        else declined.add(sourcePath)
      } finally {
        inFlight.delete(sourcePath)
      }
    })
  }

  // Ignored silently, an unheld file is invisible twice over: never on the
  // wall, and never expired either, since only an adopted file is trashed.
  // Sidecars live in the inbox by design and are not the mistake this reports.
  const unheld = new Set<string>()
  const notAnArtifact = (p: string) => {
    if (kindOf(p) !== null) return false
    if (!p.endsWith('.transom.json') && !unheld.has(p)) {
      unheld.add(p)
      console.warn(
        `[ingest] the wall does not hold ${extname(p) || 'that'}: ` +
          `${basename(p)} stays in the inbox and never expires`,
      )
    }
    return true
  }

  const watcher = watchTree(config.inbox, {
    ignore: notAnArtifact,
    onFile: take,
    onGone: (p) => {
      const id = store.forget(p)
      if (id) console.log(`[watch] ${basename(p)} left the inbox; its card is off the wall`)
    },
  })
  void watcher.ready.then(() => {
    console.log(`[watch] ${config.inbox} (ttl ${wallTtlMs() / 1000}s)`)
  })

  // A watcher is allowed to miss; the wall is not. Anything the store never
  // took in is offered again on a tick, and adopted at its own mtime so a
  // late catch decays from when it landed.
  const stopSweep = startSweep(config.inbox, {
    intervalMs: config.sweepMs,
    has: held,
    ignore: notAnArtifact,
    onFile: (p) => take(p, true),
  })

  return {
    close: async () => {
      stopSweep()
      await watcher.close()
    },
    ready: watcher.ready,
  }
}
