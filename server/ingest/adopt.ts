import { mkdir, rename, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { config } from '../config.ts'
import { idFor } from '../itemId.ts'
import { keptFrom, readStamp, trashStamp } from '../sidecar.ts'
import * as marks from '../markup.ts'
import { ttlMs as wallTtlMs } from '../settings.ts'
import { ttlFromName } from '../ttlSuffix.ts'
import { ingest, type Landed } from './land.ts'

/**
 * Files present at startup are adopted at their mtime, not "now" — a daemon
 * restart must not resurrect the wall or reset anything's decay. A rescued
 * file is adopted however old it is; that is what the rescue bought.
 */
export async function adopt(sourcePath: string): Promise<Landed | null> {
  // Gone between the scan and its turn: the rejection had no handler.
  const mtimeMs = await stat(sourcePath).then((s) => s.mtimeMs, () => null)
  if (mtimeMs === null) return null
  // Unsent marks hold a card the way a rescue does: nothing drops them unasked.
  const rescued =
    keptFrom(await readStamp(sourcePath)) !== null || (await marks.read(idFor(sourcePath)))?.status === 'pending'
  if (!rescued && Date.now() - mtimeMs > (ttlFromName(basename(sourcePath)) ?? wallTtlMs())) {
    await mkdir(config.trash, { recursive: true })
    const dest = join(config.trash, basename(sourcePath))
    await rename(sourcePath, dest).catch(() => {})
    await trashStamp(sourcePath, dest)
    return null
  }
  return ingest(sourcePath, mtimeMs)
}
