import express, { type Express } from 'express'
import { alert, debugItem, toastFor } from '../alert.ts'
import { MAX_SYNTH_TAKES, synthAnswered, synthAsk, synthGroup } from '../synth.ts'
import { LEVELS, type Level } from '@shared/attention.ts'
import type { ServerMessage } from '@shared/protocol.ts'

export function mountDebug(
  app: Express,
  opts: { broadcast: (msg: ServerMessage) => void; watched: () => boolean },
) {
  const { broadcast } = opts

  // Artifacts the wall makes for itself, so the question, the group and the reply
  // can be looked at with no agent producing one. Real sends: they land in the
  // inbox and are answered through the ordinary route, because a carousel nobody
  // can click is not the thing being evaluated.
  app.post('/api/debug/synth', express.json(), async (req, res) => {
    const body = (req.body ?? {}) as { what?: unknown; takes?: unknown }
    const takes = Math.min(MAX_SYNTH_TAKES, Math.max(1, Number(body.takes) || 5))
    try {
      if (body.what === 'group') {
        const made = await synthGroup(takes)
        console.log(`[synth] group of ${made.length}`)
        return void res.json({ ok: true, what: 'group', takes: made.length })
      }
      if (body.what === 'ask') {
        await synthAsk()
        return void res.json({ ok: true, what: 'ask' })
      }
      if (body.what === 'answered') {
        await synthAnswered()
        return void res.json({ ok: true, what: 'answered' })
      }
    } catch (err) {
      console.warn(`[synth] ${(err as Error).message}`)
      return void res.status(500).json({ ok: false, error: (err as Error).message })
    }
    res.status(400).json({ ok: false, what: ['group', 'ask', 'answered'] })
  })

  // Fires a level's whole treatment against an arrival that never happened, so
  // the sound, the notification and the raise can be heard rather than reasoned
  // about. Guarded like the dismiss route — a wall on a private machine — and by
  // one thing more: the button that calls this is in the wall, so `watched()`
  // is never false here and `raise` can only bring the window forward, never
  // launch one.
  app.post('/api/debug/alert/:level', (req, res) => {
    const level = req.params.level
    if (!(LEVELS as readonly string[]).includes(level))
      return void res.status(400).json({ ok: false, levels: LEVELS })
    const item = debugItem(level as Level)
    const plan = alert(item, opts.watched())
    const toast = toastFor(item, plan)
    if (toast) broadcast({ type: 'alert', alert: toast })
    console.log(`[alert] debug ${level} ${JSON.stringify(plan)}`)
    res.json({ ok: true, level, plan })
  })
}
