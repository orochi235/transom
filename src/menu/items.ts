import type { WallItem } from '@shared/protocol.ts'
import { posterTake } from '@shared/groups.ts'
import { KEEP_CAP } from '@shared/keep.ts'

/** What the pointer was over. The chain `chainAt` returns, named. */
export type Target =
  | { kind: 'card'; zone: string; id: string }
  | { kind: 'zone'; zone: string }
  | { kind: 'sky' }

export type Action =
  | 'open'
  /** One of the apps the sender offered. Which one is `Item.app`, since the
   *  actions are otherwise a closed set and an app is the sender's to name. */
  | 'openInApp'
  | 'pin'
  | 'unpin'
  /** Held at the top of the wall, or let back into the order. A zone's own
   *  pair: `pin` rescues one artifact from expiry, which is a different thing
   *  under the same word. The two never share a menu — a target is a card or a
   *  zone — so only the code has to tell them apart. */
  | 'pinZone'
  | 'unpinZone'
  | 'configureZone'
  | 'expire'
  | 'expireZone'
  | 'copyArtifact'
  /** The whole stack as one download: a group's takes, or a zone's pile. */
  | 'zipGroup'
  | 'zipZone'
  | 'copyPath'
  | 'dismiss'
  | 'undo'

export type Item = {
  action: Action
  label: string
  /** Which offered app this row opens, by position. Only on `openInApp`. */
  app?: number
  /** The kept artifact a `pin` lets go to make room, once the keep is full. */
  replace?: string
  /** Set on the one action that takes something away, so the menu can mark it
   *  without knowing which action that is. */
  grave?: boolean
}

export function targetOf(chain: readonly string[]): Target {
  const [zone, id] = chain
  if (zone && id) return { kind: 'card', zone, id }
  if (zone) return { kind: 'zone', zone }
  return { kind: 'sky' }
}

/**
 * The menu for a target, in the order it reads.
 *
 * "Unpin" rather than "drop" or "free", which both read as throwing the image
 * away — the item directly below this one.
 */
export function menuFor(
  target: Target,
  ctx: {
    item?: WallItem
    canUndo: boolean
    /** How many artifacts the zone holds, so the row says what it costs. */
    zoneCount?: number
    /** Whether the zone is already held at the top. */
    zonePinned?: boolean
    /** The row that has been clicked once and is waiting to be meant. */
    armed?: Action | null
    /** Everything kept, longest-kept first: at the cap, Pin becomes a choice
     *  of which to replace. */
    kept?: readonly WallItem[]
  },
): Item[] {
  const items: Item[] = []
  if (target.kind === 'card' && ctx.item) {
    items.push({ action: 'open', label: 'Open' })
    // The sender's own apps beside the OS default, for the take the card is
    // drawing — which for a group is the one the viewer is being asked about.
    const offered = (posterTake(ctx.item.takes ?? []) ?? ctx.item).apps ?? []
    offered.forEach((app, at) =>
      items.push({ action: 'openInApp', label: `Open in ${app.name}`, app: at }),
    )
    const kept = ctx.kept ?? []
    if (ctx.item.keptAt) items.push({ action: 'unpin', label: 'Unpin' })
    else if (kept.length < KEEP_CAP) items.push({ action: 'pin', label: 'Pin' })
    else
      for (const k of kept)
        items.push({ action: 'pin', label: `Pin in place of ${k.name}`, replace: k.id })
    if (ctx.item.attention) items.push({ action: 'dismiss', label: 'Dismiss the flag' })
    if (ctx.item.kind === 'group' && (ctx.item.takes?.length ?? 0) > 1)
      items.push({
        action: 'zipGroup',
        label: `Download zip of the group (${ctx.item.takes?.length ?? 0})`,
      })
    items.push({ action: 'copyArtifact', label: 'Copy artifact' })
    items.push({ action: 'copyPath', label: 'Copy path' })
    // The pile the card is sitting in. Here as well as on the zone's own menu
    // because a card is what the pointer lands on — a zone target needs the
    // label or the floor between piles, which is not the gesture anyone makes.
    if ((ctx.zoneCount ?? 0) > 0)
      items.push({ action: 'zipZone', label: `Download zip (${ctx.zoneCount})` })
    items.push({ action: 'expire', label: 'Expire now', grave: true })
  }
  // Taking a zone is the one gesture that can take thirty artifacts at once,
  // so the row says how many and has to be clicked twice. Not a `confirm()`:
  // a browser modal blocks the page's event loop, and the count is the whole
  // content of the question anyway.
  if (target.kind === 'zone' && (ctx.zoneCount ?? 0) > 0) {
    const n = ctx.zoneCount ?? 0
    items.push({ action: 'configureZone', label: 'Zone settings…' })
    items.push(
      ctx.zonePinned
        ? { action: 'unpinZone', label: 'Unpin the zone' }
        : { action: 'pinZone', label: 'Pin the zone to the top' },
    )
    items.push({ action: 'zipZone', label: `Download zip (${n})` })
    items.push({
      action: 'expireZone',
      label:
        ctx.armed === 'expireZone'
          ? `Really — expire ${n}`
          : `Expire the zone (${n})`,
      grave: true,
    })
  }
  if (ctx.canUndo) items.push({ action: 'undo', label: 'Undo last expiry' })
  return items
}
