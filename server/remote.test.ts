import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROTOCOL } from '@shared/remote.ts'

let root: string
let server: Server
let base: string

async function start(opts: { hasFfmpeg?: () => boolean } = {}) {
  process.env.TRANSOM_ROOT = root
  vi.resetModules()
  const { mountRemote } = await import('./remote.ts')
  const app = express()
  mountRemote(app, { token: 'tok', trustLoopback: false, ...opts })
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
}

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'transom-remote-')) })
afterEach(async () => {
  server?.close()
  await rm(root, { recursive: true, force: true })
})

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64')
const auth = { Authorization: 'Bearer tok', 'X-Transom-Protocol': String(PROTOCOL) }

function upload(zone: string, body: string, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/inbox/${zone}`, {
    method: 'POST',
    headers: { ...auth, 'X-Transom-Name': '.png', 'X-Transom-Sidecar': b64({ caption: 'c' }), ...headers },
    body,
  })
}

describe('POST /api/inbox/:zone', () => {
  it('lands the sidecar, then the file, in the zone, and answers with the path', async () => {
    await start()
    const res = await upload('z', 'png-bytes')
    expect(res.status).toBe(200)
    const { path } = (await res.json()) as { path: string }
    expect(path.startsWith(join(root, 'inbox', 'z') + '/')).toBe(true)
    expect(path.endsWith('.png')).toBe(true)
    expect(await readFile(path, 'utf8')).toBe('png-bytes')
    expect(JSON.parse(await readFile(`${path}.transom.json`, 'utf8')).caption).toBe('c')
  })

  it('writes the zone record from zoneRoot and hued, and keeps both out of the sidecar', async () => {
    await start()
    const res = await upload('z', 'x', { 'X-Transom-Sidecar': b64({ zoneRoot: '/Users/m/src/z', hued: 'background=#123456\n' }) })
    const { path } = (await res.json()) as { path: string }
    expect(JSON.parse(await readFile(join(root, 'zones', 'z.json'), 'utf8'))).toEqual({ root: '/Users/m/src/z', hued: 'background=#123456\n' })
    const side = JSON.parse(await readFile(`${path}.transom.json`, 'utf8'))
    expect(side.zoneRoot).toBeUndefined()
    expect(side.hued).toBeUndefined()
  })

  it('points a bare app at the inbox copy', async () => {
    await start()
    const res = await upload('z', 'x', { 'X-Transom-Sidecar': b64({ apps: [{ name: 'Preview', path: '@self' }] }) })
    const { path } = (await res.json()) as { path: string }
    expect(JSON.parse(await readFile(`${path}.transom.json`, 'utf8')).apps).toEqual([{ name: 'Preview', path }])
  })

  it('refuses without the token, and an old protocol, before reading the body', async () => {
    await start()
    expect((await upload('z', 'x', { Authorization: 'Bearer no' })).status).toBe(401)
    expect((await upload('z', 'x', { 'X-Transom-Protocol': '0' })).status).toBe(426)
    expect(existsSync(join(root, 'inbox'))).toBe(false)
  })

  it('refuses a zone or name that could leave the inbox', async () => {
    await start()
    expect((await upload('..%2Fx', 'x')).status).toBe(400)
    expect((await upload('a..b', 'x')).status).toBe(400)
    expect((await upload('z', 'x', { 'X-Transom-Name': '/../../evil.png' })).status).toBe(400)
    expect((await upload('z', 'x', { 'X-Transom-Name': '.exe' })).status).toBe(400)
  })

  it('refuses a video when the wall has no ffmpeg', async () => {
    await start({ hasFfmpeg: () => false })
    expect((await upload('z', 'x', { 'X-Transom-Name': '.mp4' })).status).toBe(422)
  })

  it('leaves nothing in the zone when the upload is cut off', async () => {
    await start()
    const ctl = new AbortController()
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('partial'))
        setTimeout(() => ctl.abort(), 50)
      },
    })
    await fetch(`${base}/api/inbox/z`, {
      method: 'POST',
      headers: { ...auth, 'X-Transom-Name': '.png', 'X-Transom-Sidecar': b64({}) },
      body,
      signal: ctl.signal,
      // @ts-expect-error node's fetch needs this for a streamed body
      duplex: 'half',
    }).catch(() => {})
    await new Promise((r) => setTimeout(r, 200))
    const zone = join(root, 'inbox', 'z')
    expect(existsSync(zone) ? readdirSync(zone) : []).toEqual([])
  })

  it('keeps the token it started with after the file is deleted', async () => {
    await start()
    await rm(join(root, 'token'), { force: true })
    expect((await upload('z', 'x')).status).toBe(200)
  })
})

describe('GET /api/answers/:name', () => {
  it('waits for the answer, hands it over once, and deletes it', async () => {
    await start()
    setTimeout(async () => {
      await mkdir(join(root, 'answers'), { recursive: true })
      await writeFile(join(root, 'answers', 'q.png'), 'answered\nleft\n')
    }, 300)
    const res = await fetch(`${base}/api/answers/q.png?wait=5`, { headers: auth })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('answered\nleft\n')
    expect(existsSync(join(root, 'answers', 'q.png'))).toBe(false)
  })
  it('says 204 when nothing came in time', async () => {
    await start()
    expect((await fetch(`${base}/api/answers/q.png?wait=1`, { headers: auth })).status).toBe(204)
  })
  it('refuses a name with a path in it', async () => {
    await start()
    expect((await fetch(`${base}/api/answers/..%2Fsettings.json`, { headers: auth })).status).toBe(400)
  })
})

describe('GET /api/whoami', () => {
  it('names the wall to a sender holding the token', async () => {
    await start()
    const res = await fetch(`${base}/api/whoami`, { headers: auth })
    expect(res.status).toBe(200)
    expect(typeof ((await res.json()) as { host: string }).host).toBe('string')
  })
})
