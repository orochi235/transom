import { UNKNOWN } from '@shared/build.ts'
import { BEAT_MS, type ServerMessage, type WallItem, type ZoneSettings } from '@shared/protocol.ts'
import type { Actions } from '@/actions.ts'
import type { Sink, Transport } from '@/transport.ts'
import { zipHere } from '@/menu/zip.ts'
import { zipName, zipPlanForGroup, zipPlanForZone } from '@shared/zipPlan.ts'
import type { DemoSet } from '../../tools/demo-set.ts'
import set from '../../demo/manifest.json'

/**
 * The daemon, without a daemon: a scripted arrival timer plus the lifetime
 * bookkeeping the real one owns, producing the same `ServerMessage` stream.
 *
 * It exists so the public wall is a wall rather than a screenshot. Everything
 * downstream of `useWall` is the ordinary client, and the writes it makes come
 * back as the same broadcasts.
 */

/** Vite emits every picture in the set and hands back its hashed URL. Keyed by
 *  file name, since the manifest names them the way the packer wrote them. */
const urls = import.meta.glob('../../demo/img/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const urlOf = (file: string) => {
  const name = file.slice(file.lastIndexOf('/') + 1)
  return urls[`../../demo/img/${name}`] ?? ''
}

/** Shorter than the real default. A viewer gives a demo a minute, not five,
 *  and the point of the wall is that things leave it. */
const TTL_MS = 150_000
/** How often one lands. Slow enough to read, fast enough that a viewer who
 *  waits sees the wall change rather than sit. */
const ARRIVE_MS = 5000
/** How much of the wall is already there when someone arrives, so the piles
 *  have depth rather than filling from empty. Spread across the set's zones,
 *  so it climbs with them: at 26 over six zones every pile was four cards. */
const STANDING = 40

const { items: manifest, zones } = set as DemoSet

/** Where the bytes for an id are. The demo ships one picture per card and no
 *  originals, so a zip of it holds what the wall draws. */
const urlById = (held: readonly WallItem[]) => {
  const by = new Map<string, string>()
  for (const item of held) {
    by.set(item.id, item.origUrl || item.url)
    for (const take of item.takes ?? []) by.set(take.id, take.origUrl || take.url)
  }
  return (id: string) => by.get(id)
}

/**
 * The set, dealt round-robin across its zones.
 *
 * The manifest is in the order the pictures really landed, which on a wall
 * that renders in bursts is one zone at a time. Played in that order the demo
 * opens showing a single pile, and the thing it exists to show — one pile per
 * project, side by side — never appears.
 */
const pictures = (() => {
  const byZone = new Map<string, DemoSet['items']>()
  for (const pic of manifest) {
    const queue = byZone.get(pic.zone) ?? []
    queue.push(pic)
    byZone.set(pic.zone, queue)
  }
  const queues = [...byZone.values()]
  const dealt: DemoSet['items'] = []
  for (let i = 0; dealt.length < manifest.length; i += 1) {
    for (const queue of queues) if (queue[i]) dealt.push(queue[i]!)
  }
  return dealt
})()

export function createDemoDaemon() {
  let sink: Sink | null = null
  const items = new Map<string, WallItem>()
  const zoneSettings: Record<string, ZoneSettings> = {}
  const pinnedZones: Record<string, number> = {}
  /** One expiry deep, which is what the real wall offers. */
  let undone: WallItem[] = []
  let next = 0
  let serial = 0
  const timers: ReturnType<typeof setInterval>[] = []

  const send = (msg: ServerMessage) => sink?.message(msg)

  /** One picture from the set as an item on the wall. The set cycles, so a
   *  long-running demo shows the same render again under a new id — which is
   *  what an agent re-rendering after an edit does anyway. */
  const mint = (bornAt: number): WallItem => {
    const pic = pictures[next % pictures.length]!
    next += 1
    const url = urlOf(pic.file)
    return {
      id: `demo-${serial++}`,
      url,
      origUrl: url,
      zone: pic.zone,
      name: pic.name,
      bornAt,
      // No filesystem behind a browser, so "copy path" copies where the
      // picture actually is. A local path would mean nothing to a stranger.
      path: new URL(url, location.href).href,
      w: pic.w,
      h: pic.h,
      ...(pic.repo ? { repo: pic.repo } : {}),
      ...(pic.sha ? { sha: pic.sha } : {}),
    }
  }

  const ttlOf = (item: WallItem) => {
    const lifetime = zoneSettings[item.zone]?.lifetime
    if (typeof lifetime === 'string') return Infinity
    return lifetime ?? item.ttlMs ?? TTL_MS
  }

  const sweep = () => {
    const now = Date.now()
    for (const item of [...items.values()]) {
      if (item.keptAt !== undefined) continue
      if (now - item.bornAt < ttlOf(item)) continue
      items.delete(item.id)
      send({ type: 'expire', id: item.id })
    }
  }

  const take = (item: WallItem) => {
    items.delete(item.id)
    send({ type: 'expire', id: item.id })
  }

  const start: Transport = (next_) => {
    sink = next_
    // From nothing every time: StrictMode subscribes, tears down and
    // subscribes again, and a wall that kept its items would open holding two
    // of everything.
    items.clear()
    undone = []
    next = 0
    const now = Date.now()
    // Spread backwards across the window so the oldest is nearly gone and the
    // newest has just landed: the wall as it looks mid-afternoon, not at boot.
    for (let i = STANDING - 1; i >= 0; i -= 1) {
      const item = mint(now - Math.round((i / STANDING) * TTL_MS * 0.9))
      items.set(item.id, item)
    }
    send({
      type: 'snapshot',
      now,
      ttlMs: TTL_MS,
      items: [...items.values()],
      zoneColors: zones,
      pinnedZones,
      zoneSettings,
      // Nothing to be stale against: the demo has no daemon behind it, and
      // `agree` reads an unknown on either side as no claim rather than a
      // mismatch.
      build: UNKNOWN,
      disk: null,
    })
    sink.connected(true)

    timers.push(
      setInterval(() => {
        const item = mint(Date.now())
        items.set(item.id, item)
        send({ type: 'arrive', item })
      }, ARRIVE_MS),
      setInterval(sweep, 1000),
      setInterval(() => send({ type: 'beat' }), BEAT_MS),
    )

    return () => {
      for (const t of timers) clearInterval(t)
      timers.length = 0
      sink = null
    }
  }

  const actions: Actions = {
    keep: (id, on) => {
      const item = items.get(id)
      if (!item) return
      const keptAt = on ? Date.now() : null
      if (keptAt === null) delete item.keptAt
      else item.keptAt = keptAt
      send({ type: 'keep', id, keptAt })
    },
    expire: (id) => {
      const item = items.get(id)
      if (!item) return
      undone = [item]
      take(item)
    },
    dismiss: (id) => {
      const item = items.get(id)
      if (!item) return
      delete item.attention
      send({ type: 'dismiss', id })
    },
    // Nothing in the set asks a question, so neither of these has anything to
    // act on. They are here because `Actions` is the wall's whole vocabulary,
    // not a list of what this daemon happens to use.
    answer: (id, reply) =>
      send({
        type: 'reply',
        id,
        reply: {
          status: 'answered',
          ...(reply.choice === undefined ? {} : { choice: reply.choice }),
          text: reply.text ?? '',
          at: Date.now(),
        },
        ...(reply.take === undefined ? {} : { take: reply.take }),
      }),
    // No session sent any of the set, so a drawing has nowhere to go.
    markUp: async () => false,
    discardMarkup: () => {},
    openInApp: () => {},
    // The demo wall ships a fixed set and has no inbox to write into.
    synth: async () => false,
    undo: async () => {
      const back = undone
      undone = []
      for (const item of back) {
        items.set(item.id, item)
        send({ type: 'arrive', item })
      }
      return back.map((i) => i.id)
    },
    // No daemon to stream an archive, so the page builds it from the pictures
    // it is already showing.
    zipZone: (zone) => {
      const held = [...items.values()]
      void zipHere(zipPlanForZone(held, zone), urlById(held), zipName(zone))
    },
    zipGroup: (id) => {
      const item = items.get(id)
      if (!item) return
      const held = [...items.values()]
      void zipHere(zipPlanForGroup(item), urlById(held), zipName(`${item.zone}-${item.name}`))
    },
    expireZone: (zone) => {
      const taken = [...items.values()].filter((i) => i.zone === zone && i.keptAt === undefined)
      undone = taken
      for (const item of taken) take(item)
    },
    pinZone: (zone, on) => {
      const pinnedAt = on ? Date.now() : null
      if (pinnedAt === null) delete pinnedZones[zone]
      else pinnedZones[zone] = pinnedAt
      send({ type: 'zonePin', zone, pinnedAt })
    },
    setZoneSettings: (zone, patch) => {
      const current: ZoneSettings = { ...zoneSettings[zone] }
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete current[key as keyof ZoneSettings]
        // The patch and the settings agree field for field; the cast is the
        // price of walking them as entries rather than naming all six.
        else (current as Record<string, unknown>)[key] = value
      }
      if (Object.keys(current).length === 0) delete zoneSettings[zone]
      else zoneSettings[zone] = current
      send({ type: 'zoneSettings', zone, settings: zoneSettings[zone] ?? {} })
    },
    setTtl: () => {},
    // The sidebar's alert row is the daemon making a noise, which this one
    // cannot do. Refusing is the honest answer and the row already reads it.
    fireAlert: async () => null,
  }

  return { transport: start, actions }
}
