import { stat } from 'node:fs/promises'
import { artifactsIn, SETTLE_MS } from './watchTree.ts'

/**
 * The backstop: whatever is in the inbox and not in the store gets offered
 * again, on a tick, forever.
 *
 * No watcher is reliable enough to be the only path in. chokidar's per-
 * directory registration loses a file written into a zone between the scan and
 * the watch ([#1471](https://github.com/paulmillr/chokidar/issues/1471), open),
 * and a native recursive watch coalesces and can drop under load. Both cost a
 * picture that is simply never seen — there is no error anywhere, which is why
 * two artifacts sat unnoticed in the inbox for an evening.
 *
 * Cheap because the store answers by source path: a sweep over a full inbox
 * does a readdir per zone and nothing else. It is deliberately not bounded to
 * a recent window — an artifact missed an hour ago is exactly the one worth
 * finding, and `adopt` still decays it from its own mtime.
 */

export interface SweepOptions {
  /** Does the store already hold this path? */
  has: (absPath: string) => boolean
  ignore?: (absPath: string) => boolean
  onFile: (absPath: string) => void
  /** A file written to within this long is left for a later pass: the sweep
   *  takes no stability wait of its own, and sharp cannot read half a PNG. */
  settleMs?: number
}

/** One pass. Returns how many artifacts it offered. */
export async function sweepOnce(root: string, opts: SweepOptions): Promise<number> {
  const settleMs = opts.settleMs ?? SETTLE_MS
  let offered = 0
  for (const abs of await artifactsIn(root)) {
    if (opts.has(abs) || opts.ignore?.(abs)) continue
    if (settleMs > 0) {
      const mtimeMs = await stat(abs).then((s) => s.mtimeMs, () => null)
      if (mtimeMs === null || Date.now() - mtimeMs < settleMs) continue
    }
    opts.onFile(abs)
    offered++
  }
  return offered
}

/** Sweep every `intervalMs`. Returns a stop function. */
export function startSweep(
  root: string,
  opts: SweepOptions & { intervalMs: number },
): () => void {
  let running = false
  const timer = setInterval(() => {
    // A slow pass must not stack behind itself on a busy inbox.
    if (running) return
    running = true
    void sweepOnce(root, opts).finally(() => {
      running = false
    })
  }, opts.intervalMs)
  // The daemon's other work decides when it exits; this must not hold it open.
  timer.unref?.()
  return () => clearInterval(timer)
}
