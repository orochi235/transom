import type { Express } from 'express'
import { rm } from 'node:fs/promises'
import { extname } from 'node:path'
import * as store from '../store.ts'
import { guard } from '../auth.ts'
import { decodeSidecar, receive, sameProtocol, seen } from '../remote.ts'
import { WORDS, type Words } from '../sidecar.ts'
import type { Mended } from '../ingest.ts'
import type { ServerMessage } from '@shared/protocol.ts'

const say = (text: string) => `transom: ${text}\n`

/**
 * What a sender does to a post after sending it, named by the path the send
 * printed — the one thing it holds, on this Mac and on a node alike. The
 * daemon's card id is a hash the sender never sees.
 */
export function mountPosts(
  app: Express,
  opts: {
    token: string
    trustLoopback?: boolean
    broadcast: (msg: ServerMessage) => void
    mend: (sourcePath: string, change: { words?: Words; file?: string }) => Promise<Mended>
  },
) {
  const { broadcast, mend } = opts
  const gate = guard(opts.token, { trustLoopback: opts.trustLoopback })

  // A card goes the way the menu's Expire sends it, so Delete's undo brings it
  // back. One take of a group leaves the rest standing.
  app.post('/api/posts/pull', gate, sameProtocol, seen, async (req, res) => {
    const path = String(req.query.path ?? '')
    const card = store.cardAt(path)
    if (!card) return void res.status(404).type('text').send(say('nothing on the wall is at that path'))
    const left = await store.expireTake(path)
    if (left) broadcast({ type: 'amend', item: left })
    else if (await store.expireNow(card.id)) broadcast({ type: 'expire', id: card.id })
    res.json({ ok: true })
  })

  app.post('/api/posts/mend', gate, sameProtocol, seen, async (req, res) => {
    const path = String(req.query.path ?? '')
    const card = store.cardAt(path)
    if (!card) return void res.status(404).type('text').send(say('nothing on the wall is at that path'))
    const blob = decodeSidecar(req.headers['x-transom-sidecar'])
    if (!blob) return void res.status(400).type('text').send(say('unreadable sidecar'))
    const words: Words = {}
    for (const key of WORDS) if (typeof blob[key] === 'string') words[key] = blob[key]
    // A group's flag and note are the card's, read from its first take, so
    // setting one on a later take would change nothing on the wall.
    if (card.kind === 'group' && (words.note !== undefined || words.attention !== undefined))
      return void res.status(422).type('text').send(say("a take's note and flag belong to its group; mend its caption or its file"))

    const name = req.headers['x-transom-name']
    let file: string | undefined
    if (typeof name === 'string') {
      // Same extension, so the path, and the card id made from it, stays good.
      const held = extname(path).toLowerCase()
      if (name.toLowerCase() !== held)
        return void res.status(422).type('text').send(say(`the card holds a ${held}, not a ${name}: pull it and post the new one`))
      const part = await receive(req, res)
      if (part === null) return
      file = part
    }
    if (file === undefined && Object.keys(words).length === 0)
      return void res.status(400).type('text').send(say('nothing to mend: give a file, --caption, --note or --attention'))

    const done = await mend(path, { words, ...(file ? { file } : {}) })
    if (file && !done.ok) await rm(file, { force: true })
    if (done.item) broadcast({ type: 'amend', item: done.item })
    if (done.ok) return void res.json({ path })
    if (done.why === 'gone') return void res.status(404).type('text').send(say('nothing on the wall is at that path'))
    if (done.why === 'busy') return void res.status(409).type('text').send(say('the wall is still taking that file in; try again'))
    if (!done.item) broadcast({ type: 'expire', id: card.id })
    res.status(422).type('text').send(
      say(done.item ? 'the wall could not read the new file, so the card kept the old one' : 'the wall could not read the file, and the card is gone'),
    )
  })
}
