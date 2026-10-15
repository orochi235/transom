/**
 * Whether the dev server is serving modules older than the files on disk.
 *
 * Vite learns of an edit only from a file event, and when macOS stops
 * delivering them it goes on serving what it transformed before — with no
 * error, and with every symptom reading as a broken feature. The ledger notes
 * each file's mtime as it is transformed and forgets it when the watcher
 * reports a change; a file whose mtime has since moved without a word from the
 * watcher is one the page is stale on.
 */

/** Where the page asks. A vite route, not `/api`, which is proxied to the daemon. */
export const CLIENT_STALE_ROUTE = '/__transom/client-stale'

/** What the route answers: the files changed on disk that the dev server has
 *  not heard about, at most `MAX_LISTED` of them, and how many there are. */
export type ClientStale = { files: string[]; count: number }

export const MAX_LISTED = 5

export type Ledger = {
  /** A file was transformed while its mtime was `mtimeMs`. */
  served: (file: string, mtimeMs: number) => void
  /** The watcher reported the file: vite knows, so it makes no claim. */
  heard: (file: string) => void
  /** The served files whose mtime on disk is past the one they were served at.
   *  `mtimeOf` answers null for a file that is gone, which counts as changed. */
  stale: (mtimeOf: (file: string) => number | null) => string[]
}

export function ledger(): Ledger {
  const at = new Map<string, number>()
  return {
    served: (file, mtimeMs) => void at.set(file, mtimeMs),
    heard: (file) => void at.delete(file),
    stale: (mtimeOf) => {
      const out: string[] = []
      for (const [file, served] of at) {
        const now = mtimeOf(file)
        if (now === null || now > served) out.push(file)
      }
      return out.sort()
    },
  }
}
