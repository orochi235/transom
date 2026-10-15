import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { config } from './config.ts'
import * as store from './store.ts'
import { kindOf } from './kind.ts'
import { ttlMs as wallTtlMs } from './settings.ts'
import { createLimiter } from './limit.ts'
import { watchTree } from './watchTree.ts'
import { startSweep } from './inboxSweep.ts'
import { adopt } from './ingest/adopt.ts'
import { ingest, type Landed } from './ingest/land.ts'
import type { Arrival, Via } from './ingest/arrival.ts'

export { stampOriginal } from './ingest/stampOriginal.ts'
export { describeArrival, type Arrival, type Via } from './ingest/arrival.ts'
export type { Landed } from './ingest/land.ts'

export function watchInbox(onLand: (landed: Landed, arrival: Arrival) => void) {
  // Capped because ingest is the daemon's only heavy work: a decode, a resize,
  // a webp encode and a full-resolution re-encode per file. Uncapped, a restart
  // with a full inbox starts all of them at once.
  const gate = createLimiter(config.ingestAtOnce)
  const inFlight = new Set<string>()
  // Offered, and ingest wanted nothing to do with it — a file sharp cannot
  // read. Without this the sweep re-offers it every tick until it ages out.
  const declined = new Set<string>()
  const held = (p: string) => store.has(p) || inFlight.has(p) || declined.has(p)

  // Adoptions queued behind the gate before the watcher is ready: `ready`
  // waits on them, so the reaper never sees a store missing queued cards.
  const adoptions: Promise<void>[] = []
  let collecting = true
  const take = (sourcePath: string, adopting: boolean, via: Via) => {
    // Several paths reach the same artifact on purpose: the watch, the
    // adopting scan, the sweep, and the events ingest's own stamp rewrite
    // fires. The store answers by source path, so the rest are dropped here.
    if (held(sourcePath)) return
    inFlight.add(sourcePath)
    // Read at arrival rather than when the turn comes: a file waiting behind
    // others must not be dated when it finally runs.
    const at = Date.now()
    const done = gate(async () => {
      try {
        const mtimeMs = via === 'start' ? null : await stat(sourcePath).then((s) => s.mtimeMs, () => null)
        const landed = adopting ? await adopt(sourcePath) : await ingest(sourcePath, at)
        if (landed)
          onLand(landed, {
            via,
            noticedMs: mtimeMs === null ? null : Math.max(0, at - mtimeMs),
            ingestMs: mtimeMs === null ? null : Date.now() - at,
          })
        else declined.add(sourcePath)
      } finally {
        inFlight.delete(sourcePath)
      }
    })
    if (adopting && collecting) adoptions.push(done)
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
    onFile: (p, adopting) => take(p, adopting, adopting ? 'start' : 'watch'),
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
    onFile: (p) => take(p, true, 'sweep'),
  })

  return {
    close: async () => {
      stopSweep()
      await watcher.close()
    },
    ready: watcher.ready.then(async () => {
      await Promise.allSettled(adoptions)
      collecting = false
      adoptions.length = 0
    }),
  }
}
