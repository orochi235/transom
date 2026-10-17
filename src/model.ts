import type { LayoutItem } from 'windease'
import { emphasisAt } from '@shared/attention.ts'
import type { WallItem } from '@shared/protocol.ts'

/** What `createStack`'s strategy reads: a windease item plus the fields the
 *  arrangement needs. `aspect` is for the mesh, never for the layout. */
export type StackItem = LayoutItem & {
  zone: string
  age01: number
  aspect: number
  emphasis: number
  /** The band's range leaves this one out. Read for rank, not for opacity:
   *  what it buys is the pile closing over the gap. */
  excluded: boolean
  /** When it was rescued. A kept item leaves its pile for the kept band. */
  keptAt?: number
}

/** `now` is the daemon's clock, not the browser's — decay stays server-anchored
 *  so a reload changes nothing about the wall. */
export function toStackItems(
  items: readonly WallItem[],
  clock: { now: number; ttlMs: number },
  excluded: ReadonlySet<string> = new Set(),
): StackItem[] {
  return items.map((i) => ({
    id: i.id,
    zone: i.zone,
    // A rescued item ages to where it stood when it was rescued and no
    // further: the freeze is the whole of what keeping does to the wall.
    age01: Math.max(0, Math.min(1, ((i.keptAt ?? clock.now) - i.bornAt) / (i.ttlMs ?? clock.ttlMs))),
    aspect: i.h > 0 ? i.w / i.h : 1,
    // On the daemon's clock for the same reason age01 is: a reload must not
    // restart a flag's hold.
    emphasis: emphasisAt(i.attention, i.bornAt, clock.now),
    excluded: excluded.has(i.id),
    ...(i.keptAt === undefined ? {} : { keptAt: i.keptAt }),
  }))
}
