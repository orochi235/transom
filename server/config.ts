import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseBytes } from './bytes.ts'
import { parseDuration } from '../shared/duration.ts'
import { CLIENT_PORT, DAEMON_PORT } from './ports.ts'

const root = process.env.TRANSOM_ROOT ?? join(homedir(), 'transom')

export const config = {
  root,
  token: join(root, 'token'),
  inbox: join(root, 'inbox'),
  cache: join(root, '.cache'),
  trash: join(root, 'trash'),
  /** Where a question's answer lands, named for the file `bin/transom` sent.
   *  Not beside the image: expiry renames that into the trash. */
  answers: join(root, 'answers'),
  /** Drawings sent back from the lightbox, one composite and one record per
   *  artifact. Beside the answers for the same reason. */
  marks: join(root, 'marks'),
  port: DAEMON_PORT,
  ttlMs: parseDuration(process.env.TRANSOM_TTL ?? '8h') ?? 28_800_000,
  trashMs: parseDuration(process.env.TRANSOM_TRASH_TTL ?? '24h') ?? 86_400_000,
  trashMaxBytes: parseBytes(process.env.TRANSOM_TRASH_MAX, 10 * 1024 ** 3),
  /** The inbox and the thumbnail cache together: what the wall is holding. */
  wallMaxBytes: parseBytes(process.env.TRANSOM_WALL_MAX, 20 * 1024 ** 3),
  logMaxBytes: parseBytes(process.env.TRANSOM_LOG_MAX, 25 * 1024 ** 2),
  uploadMaxBytes: 2 * 1024 ** 3,
  /** An answer nobody collected, and a partial upload, are both abandoned by now. */
  answersMs: 86_400_000,
  incomingMs: 3_600_000,
  reapMs: 10 * 60_000,
  incoming: join(root, '.incoming'),
  logs: join(homedir(), '.local', 'state', 'transom'),
  maxEdge: 1024,
  /** Files ingested at once. Each one decodes, resizes, encodes a webp and
   *  re-encodes a full-resolution PNG, so this is the daemon's memory ceiling
   *  in practice. Overridable so the ceiling can be measured rather than
   *  argued about. */
  ingestAtOnce: Number(process.env.TRANSOM_INGEST_AT_ONCE ?? 3),
  /** How often the inbox is swept for artifacts the store never took in. The
   *  watch is an optimization over this, not the other way round. */
  sweepMs: Number(process.env.TRANSOM_SWEEP_MS ?? 30_000),
  /** What an arrival at a level that asks for noise plays. */
  alertSound: process.env.TRANSOM_ALERT_SOUND ?? '/System/Library/Sounds/Glass.aiff',
  /** How the daemon opens the wall when something asks to be seen and nothing
   *  is connected. Its own profile, so the wall is not in the main browser's
   *  process pool and cannot be tab-discarded. */
  wallBrowser: process.env.TRANSOM_WALL_BROWSER ?? 'Google Chrome',
  wallUrl: process.env.TRANSOM_WALL_URL ?? `http://localhost:${CLIENT_PORT}`,
  wallProfile: process.env.TRANSOM_WALL_PROFILE ?? '/tmp/transom',
  /** How a page is turned into a picture. Chrome rather than a driver: it is
   *  already installed, already spawned for the alerts, and a headless driver
   *  is a 150MB dependency for one screenshot. */
  shotBrowser:
    process.env.TRANSOM_SHOT_BROWSER ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  /** The viewport a page is shot in. `--screenshot` captures the viewport and
   *  not the document, so a short page leaves empty card. */
  shotWidth: Number(process.env.TRANSOM_SHOT_WIDTH ?? 1280),
  shotHeight: Number(process.env.TRANSOM_SHOT_HEIGHT ?? 800),
  /** The viewport a mesh is postered in. Square, because the subject is an
   *  object in space rather than a document. */
  meshShotEdge: Number(process.env.TRANSOM_MESH_SHOT_EDGE ?? 1024),
  /** Longer than a page's: the mesh is drawn by software GL, and `ingestAtOnce`
   *  of them can be drawing at the same time on the same cores. Measured: three
   *  at once miss a 15s ceiling that one meets in three seconds. */
  meshShotTimeoutMs: Number(process.env.TRANSOM_MESH_SHOT_TIMEOUT_MS ?? 45_000),
  /** Chrome does not exit after writing the shot, so the daemon kills it. This
   *  is how long the page gets to finish painting first. */
  shotTimeoutMs: Number(process.env.TRANSOM_SHOT_TIMEOUT_MS ?? 15_000),
  /** How a video is turned into a picture, and how its runtime is read.
   *  `bin/transom` refuses a video when the first is not on PATH, so a file the
   *  daemon could not poster never lands in the inbox to sit there forever. */
  ffmpeg: process.env.TRANSOM_FFMPEG ?? 'ffmpeg',
  ffprobe: process.env.TRANSOM_FFPROBE ?? 'ffprobe',
  /** Where the poster is seeked from. A fade-in or a screen recording opens on
   *  black often enough that frame 0 is the worse default; anything shorter
   *  than this falls back to it. */
  posterAtMs: parseDuration(process.env.TRANSOM_POSTER_AT ?? '1s') ?? 1000,
  /** ffmpeg exits on its own, unlike Chrome. This is the ceiling on a file
   *  pathological enough not to.  */
  posterTimeoutMs: Number(process.env.TRANSOM_POSTER_TIMEOUT_MS ?? 20_000),
}
