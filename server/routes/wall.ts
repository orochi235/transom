import express, { type Express } from 'express'
import { build, stamp } from '../build.ts'
import { config } from '../config.ts'
import * as store from '../store.ts'
import * as settings from '../settings.ts'
import type { Disk, ServerMessage } from '@shared/protocol.ts'

export function mountWall(
  app: Express,
  opts: { broadcast: (msg: ServerMessage) => void; disk: () => Disk | null },
) {
  const { broadcast } = opts

  // What this daemon is running, for `npm run doctor` and for anything else that
  // needs to know whether the process is older than the code.
  app.get('/api/build', (_req, res) => {
    res.json(build)
  })

  // The daemon's code on disk now, read per request, for the wall to set against
  // `build`. The client cannot read git, and a stamp compiled into it is frozen at
  // whenever vite last loaded its config.
  app.get('/api/code', (_req, res) => {
    res.json(stamp())
  })

  // How long an artifact lives when it carries no TTL of its own. The daemon's,
  // not the browser's: it decides when a file moves to the trash.
  app.post('/api/settings/ttl', express.json(), async (req, res) => {
    const ms = Number((req.body as { ms?: unknown } | undefined)?.ms)
    const held = await settings.setTtl(ms)
    if (held === null) return void res.status(400).json({ ok: false, ttlMs: settings.ttlMs() })
    console.log(`[settings] ttl ${held / 1000}s`)
    broadcast({ type: 'ttl', ttlMs: held })
    res.json({ ok: true, ttlMs: held })
  })

  app.get('/api/health', (_req, res) => {
    // The paths are here for anything that has to open a folder without being
    // told where the wall keeps its files — the menu bar widget, today.
    res.json({
      ok: true,
      items: store.snapshot().length,
      ttlMs: settings.ttlMs(),
      inbox: config.inbox,
      trash: config.trash,
      disk: opts.disk(),
    })
  })
}
