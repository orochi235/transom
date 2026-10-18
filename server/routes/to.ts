import type { Express } from 'express'
import { basename, join } from 'node:path'
import { config } from '../config.ts'
import * as store from '../store.ts'
import { hashOfPath } from '@shared/viewHash.ts'
import { sendOriginal } from './files.ts'

/**
 * Where a sent file hangs: `/to/<zone>/<the name the send printed>` redirects
 * to its card on the wall page. The link `transom post` prints, so a sender
 * never has to know how a card's id is made. `/file/` is the same link to the
 * file itself, with no wall around it.
 */
export function mountTo(app: Express) {
  app.get('/to/:zone/:name', (req, res) => {
    const { zone, name } = req.params
    // The page is on this host under whatever name the reader reached it by,
    // which `localhost` in `wallUrl` is not from another machine.
    const page = new URL(config.wallUrl)
    page.hostname = req.hostname
    const card = heldAt(zone, name)?.card ?? null
    // Not adopted yet, or expired: the pile it was sent to is the nearest thing.
    res.redirect(302, `${page.origin}/${hashOfPath(card ? [card.zone, card.id] : [zone])}`)
  })

  // The same file with no wall around it. No pile to fall back to: a file link
  // that answers with a page would read as the file.
  app.get('/file/:zone/:name', (req, res) => {
    const held = heldAt(req.params.zone, req.params.name)
    if (!held) return void res.status(404).type('text').send('transom: not on the wall\n')
    sendOriginal(res, held.path)
  })
}

/** The card a sent file hangs on, by the zone and name its send printed. A name
 *  that tries to climb out of its zone holds nothing. */
function heldAt(zone: string, name: string) {
  if (basename(zone) !== zone || basename(name) !== name) return null
  const path = join(config.inbox, zone, name)
  const card = store.cardAt(path)
  return card ? { card, path } : null
}
