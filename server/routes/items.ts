import express, { type Express } from 'express'
import { spawn } from 'node:child_process'
import * as store from '../store.ts'
import type { ServerMessage } from '@shared/protocol.ts'

/** The toast for an app that would not open, on the row the alerts already use. */
const openFailed = (id: string, app: string): ServerMessage => ({
  type: 'alert',
  alert: { id, zone: '', level: 'problem', asks: `no app named ${app}`, name: app },
})

export function mountItems(app: Express, opts: { broadcast: (msg: ServerMessage) => void }) {
  const { broadcast } = opts

  // The only route that writes. A wall on a private machine, so the guard is
  // that dismissing something already visible to the viewer costs nothing.
  app.post('/api/items/:id/dismiss', async (req, res) => {
    // One take dropped without a verdict: not a point among the choices, and not
    // the card's own dismiss either, which takes every open take with it.
    const take = typeof req.query.take === 'string' ? req.query.take : undefined
    if (take !== undefined) {
      const dropped = await store.answer(req.params.id, 'dismissed', '', undefined, take)
      const reply = store.replyOf(req.params.id, take)
      if (dropped && reply) {
        broadcast({
          type: 'reply',
          id: req.params.id,
          reply,
          take,
          ...(store.posterAt(req.params.id) ? { poster: store.posterAt(req.params.id)! } : {}),
        })
      }
      return void res.json({ ok: dropped, cleared: dropped })
    }
    const cleared = await store.dismiss(req.params.id, req.query.question === 'close')
    const reply = store.replyOf(req.params.id)
    if (cleared && reply?.status === 'dismissed') broadcast({ type: 'reply', id: req.params.id, reply })
    else if (cleared) broadcast({ type: 'dismiss', id: req.params.id })
    res.json({ ok: true, cleared })
  })

  // Answers the question on a card. Where the agent offered choices, the answer
  // has to be one of them: the agent branches on the exact string.
  app.post('/api/items/:id/answer', express.json(), async (req, res) => {
    const body = (req.body ?? {}) as { text?: unknown; choice?: unknown; take?: unknown }
    const takeId = typeof body.take === 'string' ? body.take : undefined
    // A take's question is the take's, so the choices to validate against are
    // whichever question is being answered.
    const asked = takeId === undefined
      ? store.snapshot().find((i) => i.id === req.params.id)
      : store.takeAt(takeId)?.take
    const choice = typeof body.choice === 'string' ? body.choice : undefined
    const text = typeof body.text === 'string' ? body.text : ''
    // The chip is the submit: where choices were offered the answer is one of
    // them — the agent branches on the exact string — and where they were not,
    // the free text is the answer and must say something.
    const ok = asked?.choices ? choice !== undefined && asked.choices.includes(choice) : choice === undefined && text.trim() !== ''
    if (!ok) return void res.status(400).json({ ok: false })
    const answered = await store.answer(req.params.id, 'answered', text, choice, takeId)
    const reply = store.replyOf(req.params.id, takeId)
    if (answered && reply) {
      const poster = store.posterAt(req.params.id)
      broadcast({
        type: 'reply',
        id: req.params.id,
        reply,
        ...(takeId === undefined ? {} : { take: takeId }),
        ...(poster === null ? {} : { poster }),
      })
    }
    res.json({ ok: answered })
  })

  app.post('/api/items/:id/keep', async (req, res) => {
    const keptAt = await store.keep(req.params.id, req.query.on !== '0')
    if (keptAt !== false) broadcast({ type: 'keep', id: req.params.id, keptAt })
    res.json({ ok: keptAt !== false, keptAt: keptAt === false ? null : keptAt })
  })

  // The wall already takes everything eventually; this only says when. The
  // broadcast is `expire`, the same message the sweeper sends, so a client
  // cannot tell a hastened death from a natural one and needs no second path.
  app.post('/api/items/:id/expire', async (req, res) => {
    const gone = await store.expireNow(req.params.id)
    if (gone) broadcast({ type: 'expire', id: req.params.id })
    res.json({ ok: gone })
  })

  // Whatever the OS would have opened the artifact with. The browser cannot
  // call `open`, so the daemon does — and only ever on a path the store already
  // holds, so the route cannot be pointed at an arbitrary file.
  app.post('/api/items/:id/open', (req, res) => {
    const path = store.resolveOriginal(req.params.id)
    if (!path) return void res.sendStatus(404)
    // An app the sender offered, by its position in that offer — never a name and
    // never a path from the browser, which is the property this route already
    // had for the file it opens and must not lose for the app it opens it with.
    const at = Number(req.query.app)
    if (req.query.app !== undefined) {
      const apps = store.appsAt(req.params.id)
      const app = Number.isInteger(at) ? apps[at] : undefined
      if (!app) return void res.status(400).json({ ok: false, error: 'no such app' })
      const proc = spawn('open', ['-a', app.name, app.path], { stdio: 'ignore', detached: true })
      // A missing app costs the open, and a button that silently does nothing is
      // worse than one that says why — so unlike an alert's spawn, this speaks.
      proc.on('exit', (code) => {
        if (code !== 0) broadcast(openFailed(req.params.id, app.name))
      })
      proc.on('error', () => broadcast(openFailed(req.params.id, app.name)))
      proc.unref()
      return void res.json({ ok: true })
    }
    spawn('open', [path], { stdio: 'ignore', detached: true }).unref()
    res.json({ ok: true })
  })

  app.post('/api/undo', async (_req, res) => {
    const items = await store.undoExpiry()
    for (const item of items) broadcast({ type: 'arrive', item })
    res.json({ ok: items.length > 0, restored: items.map((i) => i.id) })
  })
}
