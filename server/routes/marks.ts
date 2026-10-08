import express, { type Express } from 'express'
import { guard } from '../auth.ts'
import * as store from '../store.ts'
import { pngOf, sawSession } from '../markup.ts'
import type { ServerMessage } from '@shared/protocol.ts'

/** Returns the announcer, for the tick that rechecks whether senders are still running. */
export function mountMarks(
  app: Express,
  opts: { token: string; broadcast: (msg: ServerMessage) => void },
): (news: store.MarkNews) => void {
  const { broadcast, token } = opts

  /** A drawing's change, and the reply it closed a question with if it did. */
  function announceMarks(news: store.MarkNews) {
    broadcast({ type: 'markup', id: news.id, markup: news.markup, ...(news.take ? { take: news.take } : {}) })
    if (news.reply) {
      broadcast({
        type: 'reply',
        id: news.id,
        reply: news.reply,
        ...(news.take ? { take: news.take } : {}),
        ...(news.poster ? { poster: news.poster } : {}),
      })
    }
  }

  // *No, like this*: a picture drawn on in the lightbox, flattened onto the
  // render. `:id` is a card's or one take's. The body carries the composite as a
  // data URL, so it is sized for a full-resolution PNG rather than a verdict.
  app.post('/api/items/:id/markup', express.json({ limit: '64mb' }), async (req, res) => {
    const body = (req.body ?? {}) as { png?: unknown; marks?: unknown; text?: unknown }
    const png = typeof body.png === 'string' ? /^data:image\/png;base64,(.+)$/.exec(body.png)?.[1] : undefined
    if (!png) return void res.status(400).json({ ok: false })
    const news = await store.markUp(req.params.id, {
      png: Buffer.from(png, 'base64'),
      marks: body.marks ?? null,
      text: typeof body.text === 'string' ? body.text : '',
    })
    if (!news) return void res.status(404).json({ ok: false })
    console.log(`[marks] ${req.params.id.slice(0, 8)} ${news.markup.status}${news.markup.via ? ` via ${news.markup.via}` : ''}`)
    announceMarks(news)
    res.json({ ok: true, markup: news.markup })
  })

  app.post('/api/items/:id/markup/discard', async (req, res) => {
    const news = await store.discardMarks(req.params.id)
    if (news) announceMarks(news)
    res.json({ ok: news !== null })
  })

  // The hook, at a session's tool call, collecting every drawing waiting for
  // it. Delivered the moment it is handed over: the hook prints it to the model
  // in the same breath.
  app.post('/api/marks/claim', guard(token), express.json(), async (req, res) => {
    const session = (req.body as { session?: unknown } | undefined)?.session
    if (typeof session !== 'string' || session === '') return void res.status(400).json({ ok: false })
    sawSession(session)
    const { claimed, news } = await store.claimMarks(session)
    for (const n of news) announceMarks(n)
    if (claimed.length > 0) console.log(`[marks] ${claimed.length} to ${session.slice(0, 8)}`)
    res.json({ ok: true, claimed })
  })

  app.get('/api/marks/:file', (req, res) => {
    const id = /^([0-9a-f]{32})\.png$/.exec(String(req.params.file))?.[1]
    if (!id) return void res.sendStatus(404)
    res.sendFile(pngOf(id), { dotfiles: 'allow' }, (err) => {
      if (err && !res.headersSent) res.sendStatus(404)
    })
  })

  return announceMarks
}
