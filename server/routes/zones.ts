import express, { type Express } from 'express'
import * as store from '../store.ts'
import { readPins, setPinned } from '../pins.ts'
import * as zones from '../zones.ts'
import { zoneCounts } from '../zoneCounts.ts'
import type { Lifetime } from '@shared/lifetime.ts'
import type { ServerMessage } from '@shared/protocol.ts'

export function mountZones(
  app: Express,
  opts: {
    broadcast: (msg: ServerMessage) => void
    icons: () => Record<string, string>
    pinned: (pins: Record<string, number>) => void
  },
) {
  const { broadcast } = opts

  // A whole zone, in one step. Guarded like the other writes — a wall on a
  // private machine — and by the menu asking first, which is where the thinking
  // happens: this is the one gesture that can take thirty artifacts at once.
  app.post('/api/zones/:zone/expire', async (req, res) => {
    const ids = await store.expireZone(req.params.zone)
    for (const id of ids) broadcast({ type: 'expire', id })
    if (ids.length > 0) console.log(`[expire] zone ${req.params.zone} (${ids.length})`)
    res.json({ ok: ids.length > 0, expired: ids.length })
  })

  // Holding a zone at the top, and letting it go. Reversible in one click, so
  // unlike the expiry above it asks nothing first.
  app.post('/api/zones/:zone/pin', async (req, res) => {
    const pinnedAt = await setPinned(req.params.zone, req.query.on !== '0')
    opts.pinned(await readPins())
    broadcast({ type: 'zonePin', zone: req.params.zone, pinnedAt })
    res.json({ ok: true, pinnedAt })
  })

  // What one zone overrides about itself: its color over the project's, its
  // backdrop over the wall's, its lifetime over the wall's. A field sent as null
  // goes back to inheriting. Guarded like the other writes — a wall on a private
  // machine.
  app.post('/api/zones/:zone/settings', express.json(), async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const field = <T>(key: string): T | null | undefined =>
      key in body ? (body[key] as T | null) : undefined
    const settings = await zones.set(req.params.zone, {
      color: field<string>('color'),
      backdrop: field<never>('backdrop'),
      spacing: field<number>('spacing'),
      period: field<number>('period'),
      angle: field<number>('angle'),
      lifetime: field<Lifetime>('lifetime'),
    })
    console.log(`[zone] ${req.params.zone} ${JSON.stringify(settings)}`)
    broadcast({ type: 'zoneSettings', zone: req.params.zone, settings })
    res.json({ ok: true, settings })
  })

  app.get('/api/zones', (_req, res) => {
    res.json({ zones: zoneCounts(store.snapshot(), opts.icons()) })
  })
}
