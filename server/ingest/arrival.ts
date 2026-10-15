/** Which path brought a file in: the watch, the sweep that backstops it, or
 *  the scan at startup. A sweep landing is a watch event that went missing. */
export type Via = 'watch' | 'sweep' | 'start'

export interface Arrival {
  via: Via
  /** From the file's mtime to being offered, and from there to landing. Null
   *  for a file adopted at startup, whose mtime says nothing about latency. */
  noticedMs: number | null
  ingestMs: number | null
}

const secs = (ms: number) => `${(ms / 1000).toFixed(2).padStart(6)}s`

/** The tail of an `[arrive]` line. */
export function describeArrival(a: Arrival): string {
  const via = a.via.padEnd(5)
  if (a.noticedMs === null || a.ingestMs === null) return `via ${via}`
  return `via ${via} noticed ${secs(a.noticedMs)} ingest ${secs(a.ingestMs)}`
}
