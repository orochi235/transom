import type { Express } from 'express'
import { readFile } from 'node:fs/promises'
import * as store from '../store.ts'
import { withKeyForwarder } from '../page-keys.ts'
import { readOriginal, serveZip } from '../serveZip.ts'
import { idFromOrig } from '../itemId.ts'
import { zipName, zipPlanForGroup, zipPlanForZone } from '@shared/zipPlan.ts'

export function mountFiles(app: Express) {
  app.get('/img/:id', (req, res) => {
    const path = store.resolveCache(req.params.id)
    if (!path) return void res.sendStatus(404)
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
    // dotfiles defaults to 'ignore', which 404s every path under ~/transom/.cache.
    res.sendFile(path, { dotfiles: 'allow' })
  })

  app.get('/orig/:id', (req, res) => {
    const path = store.resolveOriginal(idFromOrig(req.params.id))
    if (!path) return void res.sendStatus(404)
    // An SVG or a page opened at this URL is a document on the wall's own
    // origin, where a script in it could call every route below. Sandboxed, it
    // still renders; it just runs nothing and reaches nothing.
    res.set('Content-Security-Policy', "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:")
    res.set('X-Content-Type-Options', 'nosniff')
    res.sendFile(path, { dotfiles: 'allow' })
  })

  // What the lightbox frames a page with, as opposed to what `/orig` hands to a
  // save: the same bytes plus the forwarder that carries the wall's keys back
  // out of a frame it cannot listen inside.
  app.get('/page/:id', async (req, res) => {
    const item = store.snapshot().find((i) => i.id === req.params.id)
    const path = store.resolveOriginal(req.params.id)
    if (!path || item?.kind !== 'page') return void res.sendStatus(404)
    try {
      res.type('html').send(withKeyForwarder(await readFile(path, 'utf8')))
    } catch {
      res.sendStatus(404)
    }
  })

  // A whole stack as one download: a zone's pile, and a group's takes. Reads, so
  // unlike the writes around them these are GETs a browser can navigate to —
  // which is how the menu starts the download, without holding the archive in a
  // blob first.
  app.get('/api/zones/:zone/zip', async (req, res) => {
    const zone = req.params.zone
    const plan = zipPlanForZone(store.snapshot(), zone)
    if (plan.length === 0) return void res.sendStatus(404)
    console.log(`[zip] zone ${zone} (${plan.length})`)
    await serveZip(res, plan, zipName(zone), readOriginal(store.resolveOriginal))
  })

  app.get('/api/items/:id/zip', async (req, res) => {
    const item = store.snapshot().find((i) => i.id === req.params.id)
    if (!item) return void res.sendStatus(404)
    const plan = zipPlanForGroup(item)
    console.log(`[zip] ${item.zone}/${item.name} (${plan.length})`)
    await serveZip(res, plan, zipName(`${item.zone}-${item.name}`), readOriginal(store.resolveOriginal))
  })
}
