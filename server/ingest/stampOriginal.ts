import sharp from 'sharp'
import { stat, utimes, writeFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

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
