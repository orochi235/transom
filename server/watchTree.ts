import chokidar from 'chokidar'
import { watch as fsWatch, type FSWatcher as NativeWatcher } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/**
 * Watching the inbox for artifacts, one handle for the tree rather than one
 * per file.
 *
 * chokidar has shipped without `fsevents` since v4, so on macOS it registers a
 * separate `fs.watch` per watched path. The daemon's descriptor count then
 * grows with everything on the wall — 211 images and their sidecars cost 422 —
 * and an exhausted table does not present as a watcher fault: libuv cannot
 * allocate child-stdio pipes either, so the page shot and the wall browser
 * start failing to spawn instead. Brainhouse chased that as a spawn race for a
 * month before finding the watcher.
 *
 * So macOS and Windows use the OS's own recursive watcher, and chokidar stays
 * as the fallback for everywhere else. That is not a hedge: on Linux chokidar
 * is inotify, one watch per directory and never the descriptor bomb, while
 * recursive `fs.watch` only reached Linux in node 20 and still carries
 * caveats.
 *
 * Both backends are held to the same contract, which is why the stability wait
 * lives here rather than in chokidar's `awaitWriteFinish`: one rule about when
 * a file counts as finished, exercised on both paths by the same tests.
 */

export type TreeWatchHandler = (absPath: string, adopting: boolean) => void

export interface TreeWatchOptions {
  /** Called once per artifact. `adopting` marks a file that was already there
   *  when the watch started, which decays from its own mtime rather than now. */
  onFile: TreeWatchHandler
  /** Paths to never emit — the sidecars, which arrive in the same directory. */
  ignore?: (absPath: string) => boolean
  /** Called when an artifact's file leaves the inbox. The wall's own expiry
   *  moves the file itself and has already dropped the item, so this is for a
   *  deletion from outside — which otherwise left a card on the wall whose
   *  lightbox served a 404 forever. */
  onGone?: (absPath: string) => void
  /** Test seam; also lets a caller opt into chokidar. */
  backend?: 'native' | 'chokidar'
  /** How long a file's size must hold steady before it counts as written.
   *  `gen | transom post` streams, and sharp cannot read half a PNG. */
  settleMs?: number
  pollMs?: number
}

export interface TreeWatcher {
  /** Resolves once the watch is armed and what was already there has been
   *  handed to `onFile`. */
  ready: Promise<void>
  close(): Promise<void>
}

export const SETTLE_MS = 400
const POLL_MS = 50
// A file still growing after this is something other than a render landing.
// Give up rather than hold the slot forever; the inbox sweep re-offers it.
const SETTLE_LIMIT_MS = 60_000

/** True where the OS has a recursive watcher worth trusting: macOS (FSEvents)
 *  and Windows (ReadDirectoryChangesW). */
export function nativeRecursiveSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin' || platform === 'win32'
}

export function watchTree(root: string, opts: TreeWatchOptions): TreeWatcher {
  const backend = opts.backend ?? (nativeRecursiveSupported() ? 'native' : 'chokidar')
  return backend === 'native' ? nativeTree(root, opts) : chokidarTree(root, opts)
}

/** One level down and no further: an artifact lives in `<inbox>/<zone>/`, and
 *  a file dropped at the root belongs to no zone. */
function inAZone(root: string, abs: string): boolean {
  const rel = relative(root, abs)
  return rel !== '' && !rel.startsWith('..') && rel.split(sep).length === 2
}

/** Emits through the stability wait, at most once per path at a time. */
function gate(root: string, opts: TreeWatchOptions, isClosed: () => boolean) {
  const settleMs = opts.settleMs ?? SETTLE_MS
  const pollMs = opts.pollMs ?? POLL_MS
  const pending = new Set<string>()

  return async function offer(abs: string, adopting: boolean): Promise<void> {
    if (!inAZone(root, abs) || opts.ignore?.(abs) || pending.has(abs)) return
    pending.add(abs)
    try {
      let size = -1
      let steadyFor = 0
      const deadline = Date.now() + SETTLE_LIMIT_MS
      for (;;) {
        if (isClosed()) return
        let now: number
        try {
          const s = await stat(abs)
          if (!s.isFile()) return
          now = s.size
        } catch {
          // Gone. Either it never settled, or it has left the inbox for good;
          // the store decides which by whether it holds an item for this path.
          opts.onGone?.(abs)
          return
        }
        if (now === size) {
          steadyFor += pollMs
          if (steadyFor >= settleMs) break
        } else {
          size = now
          steadyFor = 0
        }
        if (Date.now() > deadline) return
        await new Promise((r) => setTimeout(r, pollMs))
      }
    } finally {
      pending.delete(abs)
    }
    if (!isClosed()) opts.onFile(abs, adopting)
  }
}

/** Every artifact already in the inbox: the adopting pass reads this, and so
 *  does the sweep that backstops the watch. */
export async function artifactsIn(root: string): Promise<string[]> {
  const found: string[] = []
  let zones: string[]
  try {
    zones = await readdir(root)
  } catch {
    return found
  }
  for (const zone of zones) {
    const dir = join(root, zone)
    try {
      if (!(await stat(dir)).isDirectory()) continue
      for (const name of await readdir(dir)) found.push(join(dir, name))
    } catch {
      // A zone that vanished between the two reads. Nothing to adopt.
    }
  }
  return found
}

function nativeTree(root: string, opts: TreeWatchOptions): TreeWatcher {
  let closed = false
  const offer = gate(root, opts, () => closed)
  let handle: NativeWatcher | null = null

  // What was on disk when the watch started, which is what `adopting` means.
  // Null until the listing is in: FSEvents replays a write from just before
  // the watch as a live event, so a file already in the inbox can arrive by
  // both routes at once. Deciding by whichever won would date it now, hand it
  // a fresh lifetime, and put an artifact that should have been thrown away
  // back on the wall — the exact thing adopting exists to stop.
  let present: Set<string> | null = null
  const early: string[] = []

  // Armed before the listing, not after: a file landing mid-listing then
  // arrives as a live event instead of falling into the gap between the two.
  try {
    handle = fsWatch(root, { recursive: true, persistent: true }, (_event, name) => {
      // No path detail on the event: nothing to offer, and the caller's sweep
      // is what covers it.
      if (!name) return
      const rel = name.toString()
      const abs = isAbsolute(rel) ? rel : resolve(root, rel)
      if (present === null) early.push(abs)
      else void offer(abs, present.has(abs))
    })
    // A watched root that is removed emits ENOENT rather than throwing, and
    // taking the daemon down with it helps nobody.
    handle.on('error', () => undefined)
  } catch {
    // No inbox yet. The caller creates it at boot, so this is a test seam.
  }

  const ready = artifactsIn(root).then(async (paths) => {
    const found = new Set(paths)
    present = found
    const held = early.splice(0)
    await Promise.all([
      ...paths.map((p) => offer(p, true)),
      ...held.map((p) => offer(p, found.has(p))),
    ])
  })

  return {
    ready,
    close: async () => {
      closed = true
      handle?.close()
    },
  }
}

function chokidarTree(root: string, opts: TreeWatchOptions): TreeWatcher {
  let closed = false
  let armed = false
  const offer = gate(root, opts, () => closed)

  const watcher = chokidar.watch(root, {
    depth: 1,
    ignoreInitial: false,
    persistent: true,
    // Ours, not chokidar's: one stability rule across both backends.
    awaitWriteFinish: false,
  })

  // `armed` is read when the turn comes rather than captured at the event, so
  // a file queued behind the initial scan is still adopted rather than dated
  // now — which would resurrect the wall on every restart.
  const initial: Array<Promise<void>> = []
  watcher.on('add', (p) => {
    const adopting = !armed
    const done = offer(p, adopting)
    if (adopting) initial.push(done)
  })

  watcher.on('unlink', (p) => {
    if (inAZone(root, p) && !opts.ignore?.(p)) opts.onGone?.(p)
  })

  const ready = new Promise<void>((resolve) => {
    watcher.once('ready', () => {
      armed = true
      void Promise.all(initial).then(() => resolve())
    })
  })

  return {
    ready,
    close: async () => {
      closed = true
      await watcher.close()
    },
  }
}
