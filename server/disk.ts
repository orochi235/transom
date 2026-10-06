import type { Disk } from '@shared/protocol.ts'
import { config } from './config.ts'
import { reap } from './reap.ts'
import * as store from './store.ts'

/** Reaps once the inbox has been adopted, then on a timer. Before `ready` the
 *  store holds nothing, and every thumbnail and marks record would look
 *  orphaned. A failed pass is logged and the next one tries again: a disk
 *  error must never take the daemon down. */
export function startReaper(ready: Promise<void>, onDisk: (d: Disk) => void): void {
  const pass = async () => {
    try {
      const disk = await reap({
        dirs: {
          inbox: config.inbox, cache: config.cache, trash: config.trash, answers: config.answers,
          marks: config.marks, incoming: config.incoming, logs: config.logs,
        },
        limits: config,
        inUse: store.inUse,
        evictable: store.evictable,
        evict: store.evict,
      })
      if (disk.over) console.log(`[reap] wall holds ${disk.wallBytes} bytes it may not evict, over ${disk.wallMax}`)
      onDisk(disk)
    } catch (err) {
      console.error('[reap] pass failed', err)
    }
  }
  void ready.then(() => {
    void pass()
    setInterval(() => void pass(), config.reapMs).unref()
  })
}
