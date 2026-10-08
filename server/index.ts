import express from 'express'
import { build } from './build.ts'
import { WebSocketServer, type WebSocket } from 'ws'
import { createServer } from 'node:http'
import { mkdir } from 'node:fs/promises'
import { config } from './config.ts'
import { loadToken } from './auth.ts'
import { mountRemote } from './remote.ts'
import { classifyPortHolder } from './portGuard.ts'
import * as store from './store.ts'
import { describeArrival, watchInbox } from './ingest.ts'
import { startReaper } from './disk.ts'
import { groupBadge } from '@shared/groups.ts'
import { mountMeshView } from './meshview.ts'
import { watchZoneColors } from './zoneColors.ts'
import { readPins } from './pins.ts'
import * as zones from './zones.ts'
import * as settings from './settings.ts'
import { alert, toastFor } from './alert.ts'
import { mountWall } from './routes/wall.ts'
import { mountFiles } from './routes/files.ts'
import { mountItems } from './routes/items.ts'
import { mountMarks } from './routes/marks.ts'
import { mountZones } from './routes/zones.ts'
import { mountDebug } from './routes/debug.ts'
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

mountWall(app, { broadcast, disk: () => disk })
// The poster viewer, which is a page this daemon shoots itself.
mountMeshView(app)
mountFiles(app)
mountItems(app, { broadcast })
const announceMarks = mountMarks(app, { token, broadcast })
mountZones(app, {
  broadcast,
  icons: () => zoneIcons,
  pinned: (pins) => {
    pinnedZones = pins
  },
})
mountDebug(app, { broadcast, watched: () => clients.size > 0 })

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
const inbox = watchInbox((landed, arrival) => {
  const { item } = landed
  if (landed.as === 'take' && !landed.opened) {
    console.log(`[take] ${item.zone}/${item.id.slice(0, 8)} ${groupBadge(item)} ${describeArrival(arrival)}`)
    broadcast({ type: 'take', id: item.id, take: landed.take, poster: landed.poster })
    // A group alerts once. The first take's level applies and every append after
    // it lands silently, or a group at `urgent` is one interrupt per render —
    // which is the thing a group exists to stop.
    return
  }
  console.log(`[arrive] ${item.zone}/${item.id.slice(0, 8)} ${item.w}x${item.h} ${describeArrival(arrival)}`)
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
