import sharp, { type OutputInfo } from 'sharp'
import { rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { config } from '../config.ts'
import type { Kind } from '../kind.ts'
import { orientedSize } from '../sourceSize.ts'
import { vectorDensity } from '../vectorDensity.ts'
import { framesOf } from '../frames.ts'
import { posterFor } from '../poster.ts'
import { durationOf } from '../probe.ts'

export interface Rendered {
  info: OutputInfo
  /** The artifact's own size, read before the resize that produces `info`.
   *  `info` describes the cache thumbnail, and `/orig` hands out the original. */
  source: { w: number; h: number } | null
  frames: number | null
  duration: number | null
  bytes: number | null
}

/** Writes the cache thumbnail at `cachePath`, stamped with `xmp`, and measures
 *  the artifact on the way. Null for a file that yields no picture. */
export async function render(
  kind: Kind,
  sourcePath: string,
  id: string,
  cachePath: string,
  xmp: string,
): Promise<Rendered | null> {
  let info: OutputInfo
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
    const density = meta.format === 'svg' ? vectorDensity(source, config.maxEdge) : undefined
    info = await sharp(pixelPath, density ? { density } : {})
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
  return { info, source, frames, duration, bytes }
}
