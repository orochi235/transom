import { randomUUID } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'
import type { Express, RequestHandler } from 'express'
import { PROTOCOL } from '@shared/remote.ts'
import { config } from './config.ts'
import { guard } from './auth.ts'
import { save } from './atomic.ts'
import { HELD_EXT, kindOf } from './kind.ts'

const ZONE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/
/** `.ttl30m.png`, `.png`: the part of the name `bin/transom` puts after its UUID. */
const SUFFIX = /^(\.ttl[A-Za-z0-9:-]+)?(\.[a-z0-9]+)$/
const FILE = /^[A-Za-z0-9._-]+$/

const sameProtocol: RequestHandler = (req, res, next) => {
  if (req.headers['x-transom-protocol'] === String(PROTOCOL)) return next()
  res.status(426).type('text').send(`transom: this wall speaks protocol ${PROTOCOL}. Run brew upgrade transom on the sending host.\n`)
}

let ffmpeg: boolean | undefined
const ffmpegHere = () => (ffmpeg ??= spawnSync(config.ffmpeg, ['-version'], { stdio: 'ignore' }).status === 0)

function decodeSidecar(header: string | string[] | undefined): Record<string, unknown> | null {
  if (typeof header !== 'string') return {}
  try {
    const blob = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
    return blob && typeof blob === 'object' && !Array.isArray(blob) ? blob : null
  } catch {
    return null
  }
}

export function mountRemote(
  app: Express,
  opts: { token: string; trustLoopback?: boolean; hasFfmpeg?: () => boolean },
) {
  const gate = guard(opts.token, { trustLoopback: opts.trustLoopback })
  const hasFfmpeg = opts.hasFfmpeg ?? ffmpegHere

  app.post('/api/inbox/:zone', gate, sameProtocol, async (req, res) => {
    const zone = String(req.params.zone)
    const suffix = SUFFIX.exec(String(req.headers['x-transom-name'] ?? ''))
    if (!ZONE.test(zone) || zone.includes('..') || !suffix || !HELD_EXT.includes(suffix[2]!))
      return void res.status(400).type('text').send('transom: no such zone or kind of file\n')
    const side = decodeSidecar(req.headers['x-transom-sidecar'])
    if (!side) return void res.status(400).type('text').send('transom: unreadable sidecar\n')
    const dest = join(config.inbox, zone, `${randomUUID()}${suffix[0]}`)
    if (kindOf(dest) === 'video' && !hasFfmpeg())
      return void res.status(422).type('text').send('transom: the wall has no ffmpeg for the poster frame. brew install ffmpeg on the wall.\n')
    if (Number(req.headers['content-length'] ?? 0) > config.uploadMaxBytes)
      return void res.status(413).type('text').send('transom: over the 2 GB a send may be\n')

    // Into .incoming first: a body cut off partway never reaches a zone, and
    // the reaper deletes it within the hour.
    await mkdir(config.incoming, { recursive: true })
    const part = join(config.incoming, randomUUID())
    let bytes = 0
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > config.uploadMaxBytes) req.destroy()
    })
    try {
      await pipeline(req, createWriteStream(part))
    } catch {
      await rm(part, { force: true })
      if (!res.headersSent) res.status(bytes > config.uploadMaxBytes ? 413 : 400).end()
      return
    }

    const { zoneRoot, hued, ...stamp } = side
    if (Array.isArray(stamp.apps))
      stamp.apps = stamp.apps.map((a: { name?: unknown; path?: unknown }) => (a?.path === '@self' ? { ...a, path: dest } : a))
    await mkdir(join(config.inbox, zone), { recursive: true })
    if (typeof zoneRoot === 'string' && zoneRoot !== '') {
      await mkdir(join(config.root, 'zones'), { recursive: true })
      const record = typeof hued === 'string' ? { root: zoneRoot, hued } : { root: zoneRoot }
      await save(join(config.root, 'zones', `${zone}.json`), `${JSON.stringify(record)}\n`)
    }
    // The sidecar before the image: the image arriving is what ingest triggers on.
    await save(`${dest}.transom.json`, `${JSON.stringify(stamp)}\n`)
    await rename(part, dest)
    res.json({ path: dest })
  })

  app.get('/api/answers/:name', gate, sameProtocol, async (req, res) => {
    const name = String(req.params.name)
    if (!FILE.test(name) || name.includes('..')) return void res.status(400).end()
    const file = join(config.answers, name)
    const until = Date.now() + Math.min(Number(req.query.wait ?? 0), 60) * 1000
    for (;;) {
      if (existsSync(file)) {
        const text = await readFile(file, 'utf8')
        await rm(file, { force: true })
        return void res.type('text').send(text)
      }
      if (Date.now() >= until || req.socket.destroyed) return void res.status(204).end()
      await new Promise((r) => setTimeout(r, 250))
    }
  })

  app.get('/api/whoami', gate, sameProtocol, (_req, res) => {
    res.json({ host: hostname() })
  })
}
