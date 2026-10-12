import type { Express } from 'express'
import { basename, join } from 'node:path'
import { config } from '../config.ts'
import * as store from '../store.ts'
import { hashOfPath } from '@shared/viewHash.ts'

/**
 * Where a sent file hangs: `/to/<zone>/<the name the send printed>` redirects
 * to its card on the wall page. The link `transom post` prints, so a sender
 * never has to know how a card's id is made.
 */
export function mountTo(app: Express) {
  app.get('/to/:zone/:name', (req, res) => {
    const { zone, name } = req.params
    // The page is on this host under whatever name the reader reached it by,
    // which `localhost` in `wallUrl` is not from another machine.
    const page = new URL(config.wallUrl)
    page.hostname = req.hostname
    const card = basename(zone) === zone && basename(name) === name ? store.cardAt(join(config.inbox, zone, name)) : null
    // Not adopted yet, or expired: the pile it was sent to is the nearest thing.
    res.redirect(302, `${page.origin}/${hashOfPath(card ? [card.zone, card.id] : [zone])}`)
  })
}
