import express from 'express'
import { build, stamp } from './build.ts'
import { WebSocketServer, type WebSocket } from 'ws'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { config } from './config.ts'
import { loadToken, guard } from './auth.ts'
import { mountRemote } from './remote.ts'
import { classifyPortHolder } from './portGuard.ts'
import * as store from './store.ts'
import { watchInbox } from './ingest.ts'
import { startReaper } from './disk.ts'
import { groupBadge } from '@shared/groups.ts'
import { mountMeshView } from './meshview.ts'
import { watchZoneColors } from './zoneColors.ts'
import { readPins, setPinned } from './pins.ts'
import { pngOf } from './markup.ts'
import * as zones from './zones.ts'
import * as settings from './settings.ts'
import { zoneCounts } from './zoneCounts.ts'
import { alert, debugItem, toastFor } from './alert.ts'
import { MAX_SYNTH_TAKES, synthAnswered, synthAsk, synthGroup } from './synth.ts'
import { withKeyForwarder } from './page-keys.ts'
import { readOriginal, serveZip } from './serveZip.ts'
import { idFromOrig } from './itemId.ts'
import { zipName, zipPlanForGroup, zipPlanForZone } from '@shared/zipPlan.ts'
import { LEVELS, type Level } from '@shared/attention.ts'
import type { Lifetime } from '@shared/lifetime.ts'
import { BEAT_MS, type Disk, type ServerMessage } from '@shared/protocol.ts'

await settings.load()
await zones.load()
await mkdir(config.inbox, { recursive: true })
await mkdir(config.cache, { recursive: true })
const token = await loadToken(config.token)

const app = express()
mountRemote(app, { token })
const http = createServer(app)
const wss = new WebSocketServer({ server: http, path: '/ws' })
const clients = new Set<WebSocket>()
let zoneColors: Record<string, string> = {}
let zoneIcons: Record<string, string> = {}
let pinnedZones: Record<string, number> = {}

function broadcast(msg: ServerMessage) {
  const payload = JSON.stringify(msg)
  for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(payload)
}

setInterval(() => broadcast({ type: 'beat' }), BEAT_MS).unref()

let disk: Disk | null = null

wss.on('connection', (ws) => {
  clients.add(ws)
  ws.on('close', () => clients.delete(ws))
  const hello: ServerMessage = {
    type: 'snapshot',
    now: Date.now(),
    ttlMs: settings.ttlMs(),
    items: store.snapshot(),
    zoneColors,
    pinnedZones,
    zoneSettings: zones.all(),
    build,
    disk,
  }
  ws.send(JSON.stringify(hello))
})

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

// The poster viewer, which is a page this daemon shoots itself.
mountMeshView(app)

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
  const { claimed, news } = await store.claimMarks(session)
  for (const n of news) announceMarks(n)
  if (claimed.length > 0) console.log(`[marks] ${claimed.length} to ${session.slice(0, 8)}`)
  res.json({ ok: true, claimed })
})

app.get('/api/marks/:file', guard(token), (req, res) => {
  const id = /^([0-9a-f]{32})\.png$/.exec(String(req.params.file))?.[1]
  if (!id) return void res.sendStatus(404)
  res.sendFile(pngOf(id), { dotfiles: 'allow' }, (err) => {
    if (err && !res.headersSent) res.sendStatus(404)
  })
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

/** The toast for an app that would not open, on the row the alerts already use. */
const openFailed = (id: string, app: string): ServerMessage => ({
  type: 'alert',
  alert: { id, zone: '', level: 'problem', asks: `no app named ${app}`, name: app },
})

app.post('/api/undo', async (_req, res) => {
  const items = await store.undoExpiry()
  for (const item of items) broadcast({ type: 'arrive', item })
  res.json({ ok: items.length > 0, restored: items.map((i) => i.id) })
})

// A whole zone, in one step. Guarded like the other writes — a wall on a
// private machine — and by the menu asking first, which is where the thinking
// happens: this is the one gesture that can take thirty artifacts at once.
app.post('/api/zones/:zone/expire', async (req, res) => {
  const ids = await store.expireZone(req.params.zone)
  for (const id of ids) broadcast({ type: 'expire', id })
  if (ids.length > 0) console.log(`[expire] zone ${req.params.zone} (${ids.length})`)
  res.json({ ok: ids.length > 0, expired: ids.length })
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

// Holding a zone at the top, and letting it go. Reversible in one click, so
// unlike the expiry above it asks nothing first.
app.post('/api/zones/:zone/pin', async (req, res) => {
  const pinnedAt = await setPinned(req.params.zone, req.query.on !== '0')
  pinnedZones = await readPins()
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

// Fires a level's whole treatment against an arrival that never happened, so
// the sound, the notification and the raise can be heard rather than reasoned
// about. Guarded like the dismiss route — a wall on a private machine — and by
// one thing more: the button that calls this is in the wall, so `clients.size`
// is never zero here and `raise` can only bring the window forward, never
// launch one.
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

app.post('/api/debug/alert/:level', (req, res) => {
  const level = req.params.level
  if (!(LEVELS as readonly string[]).includes(level))
    return void res.status(400).json({ ok: false, levels: LEVELS })
  const item = debugItem(level as Level)
  const plan = alert(item, clients.size > 0)
  const toast = toastFor(item, plan)
  if (toast) broadcast({ type: 'alert', alert: toast })
  console.log(`[alert] debug ${level} ${JSON.stringify(plan)}`)
  res.json({ ok: true, level, plan })
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
    disk,
  })
})

app.get('/api/zones', (_req, res) => {
  res.json({ zones: zoneCounts(store.snapshot(), zoneIcons) })
})

void readPins().then((pins) => {
  pinnedZones = pins
})

watchZoneColors((colors, icons) => {
  zoneColors = colors
  zoneIcons = icons
  broadcast({ type: 'zoneColors', zoneColors: colors })
})

store.onExpire((id) => broadcast({ type: 'expire', id }))
store.startSweeper()
// A session exiting says nothing, so whether a drawing's sender is still there
// to collect it is looked at on a tick.
setInterval(() => {
  void store.recheckSenders().then((news) => news.forEach(announceMarks))
}, 15_000).unref()
const inbox = watchInbox((landed) => {
  const { item } = landed
  if (landed.as === 'take' && !landed.opened) {
    console.log(`[take] ${item.zone}/${item.id.slice(0, 8)} ${groupBadge(item)}`)
    broadcast({ type: 'take', id: item.id, take: landed.take, poster: landed.poster })
    // A group alerts once. The first take's level applies and every append after
    // it lands silently, or a group at `urgent` is one interrupt per render —
    // which is the thing a group exists to stop.
    return
  }
  console.log(`[arrive] ${item.zone}/${item.id.slice(0, 8)} ${item.w}x${item.h}`)
  broadcast({ type: 'arrive', item })
  // After the broadcast: a wall that is already open should be showing the
  // artifact by the time anything asks the screen for attention on its behalf.
  const plan = alert(item, clients.size > 0)
  const toast = toastFor(item, plan)
  if (toast) broadcast({ type: 'alert', alert: toast })
  if (plan.sound || plan.notify || plan.raise !== 'none')
    console.log(`[alert] ${item.attention?.level} ${JSON.stringify(plan)}`)
})
startReaper(inbox.ready, (d) => {
  disk = d
  broadcast({ type: 'disk', disk: d })
})

let reportedListenError = false

// ws re-emits the http server's error on itself, so a handler on only one of
// them leaves the other copy unhandled — which throws.
const onListenError = (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') throw err
  if (reportedListenError) return
  reportedListenError = true
  void classifyPortHolder(config.port).then((holder) => {
    if (holder === 'transom') {
      console.log(`[transom] :${config.port} already serving, leaving it to run`)
      process.exit(0)
    }
    console.error(
      `[transom] port ${config.port} is held by something else. Set TRANSOM_PORT to use another.`,
    )
    process.exit(1)
  })
}

http.on('error', onListenError)
wss.on('error', onListenError)

http.listen(config.port, () => console.log(`[transom] :${config.port}`))
