import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { PROTOCOL } from '@shared/remote.ts'
import type { ServerMessage, WallItem } from '@shared/protocol.ts'

const TRANSOM = fileURLToPath(new URL('../bin/transom', import.meta.url))
const png = (width: number) =>
  sharp({ create: { width, height: 8, channels: 3, background: '#123456' } }).png().toBuffer()

let root: string
let node: string
let server: Server
let base: string
let stop: () => Promise<void>
let sent: ServerMessage[]
let store: typeof import('./store.ts')

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'transom-posts-'))
  node = await mkdtemp(join(tmpdir(), 'transom-posts-node-'))
  vi.resetModules()
  vi.stubEnv('TRANSOM_ROOT', root)
  vi.stubEnv('TRANSOM_SWEEP_MS', '40')
  await mkdir(join(root, 'inbox', 'z'), { recursive: true })
  const { watchInbox } = await import('./ingest.ts')
  const { mountPosts } = await import('./routes/posts.ts')
  store = await import('./store.ts')
  sent = []
  const broadcast = (msg: ServerMessage) => void sent.push(msg)
  const inbox = watchInbox(() => {}, (item) => broadcast({ type: 'amend', item }))
  await inbox.ready
  stop = () => inbox.close()
  const app = express()
  mountPosts(app, { token: 'tok', trustLoopback: false, broadcast, mend: inbox.mend })
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const a = server.address()
  base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`
  await writeFile(join(node, 'wall.env'), `TRANSOM_WALL=${base}\nTRANSOM_TOKEN=tok\n`)
})

afterEach(async () => {
  server.close()
  await stop()
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
  await rm(node, { recursive: true, force: true })
})

const auth = { Authorization: 'Bearer tok', 'X-Transom-Protocol': String(PROTOCOL) }
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64')

/** A card on the wall, landed an hour ago. */
async function hang(name: string, sidecar: object = { caption: 'first' }, width = 8): Promise<WallItem> {
  const path = join(root, 'inbox', 'z', name)
  await writeFile(`${path}.transom.json`, JSON.stringify(sidecar))
  await writeFile(path, await png(width))
  await vi.waitFor(() => expect(store.cardAt(path)).not.toBeNull(), { timeout: 8000 })
  return store.cardAt(path)!
}

function mend(path: string, opts: { words?: object; file?: Buffer; ext?: string; headers?: object } = {}) {
  return fetch(`${base}/api/posts/mend?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: {
      ...auth,
      'X-Transom-Sidecar': b64(opts.words ?? {}),
      ...(opts.file ? { 'X-Transom-Name': opts.ext ?? '.png' } : {}),
      ...opts.headers,
    },
    ...(opts.file ? { body: new Uint8Array(opts.file) } : {}),
  })
}

const pull = (path: string, headers: object = auth) =>
  fetch(`${base}/api/posts/pull?path=${encodeURIComponent(path)}`, { method: 'POST', headers: { ...headers } })

const amended = () => sent.filter((m): m is Extract<ServerMessage, { type: 'amend' }> => m.type === 'amend')

describe('mend', () => {
  it('changes the words and keeps the card where it was', async () => {
    const was = await hang('a.png')
    const path = was.path
    const res = await mend(path, { words: { caption: 'second', note: 'look here', attention: 'look' } })
    expect(res.status).toBe(200)
    const now = store.cardAt(path)!
    expect(now.id).toBe(was.id)
    expect(now.bornAt).toBe(was.bornAt)
    expect(now.name).toBe('second')
    expect(now.note).toBe('look here')
    expect(now.attention?.level).toBe('look')
    expect(amended().at(-1)!.item.name).toBe('second')
  })

  it('warns about nothing it wrote into the inbox on the way', async () => {
    const warn = vi.spyOn(console, 'warn')
    const was = await hang('a.png')
    await mend(was.path, { words: { caption: 'second' } })
    await new Promise((r) => setTimeout(r, 200))
    expect(warn.mock.calls.flat().join('\n')).not.toMatch(/does not hold/)
    warn.mockRestore()
  })

  it('clears a word given as empty', async () => {
    const was = await hang('a.png', { caption: 'first', note: 'n', attention: 'look' })
    await mend(was.path, { words: { note: '', attention: '' } })
    const now = store.cardAt(was.path)!
    expect(now.note).toBeUndefined()
    expect(now.attention).toBeUndefined()
    expect(now.name).toBe('first')
  })

  it("starts a hand-dropped file's sidecar from the name it was captioned by", async () => {
    const path = join(root, 'inbox', 'z', 'by-hand.png')
    await writeFile(path, await png(8))
    await vi.waitFor(() => expect(store.cardAt(path)).not.toBeNull(), { timeout: 8000 })
    await mend(path, { words: { note: 'n', attention: 'look' } })
    expect(store.cardAt(path)!.name).toBe('by-hand')
  })

  it('replaces the file at a new URL, at the same age, and keeps it after a restart', async () => {
    const was = await hang('a.png')
    const res = await mend(was.path, { file: await png(20) })
    expect(res.status).toBe(200)
    const now = store.cardAt(was.path)!
    expect(now.w).toBe(20)
    expect(now.bornAt).toBe(was.bornAt)
    expect(now.url).not.toBe(was.url)
    expect(now.url.startsWith(`/img/${was.id}?v=`)).toBe(true)
    // Adoption ages a file by its mtime.
    expect(Math.abs((await stat(was.path)).mtimeMs - was.bornAt)).toBeLessThan(2)
    expect(await readdir(join(root, '.incoming'))).toEqual([])
  })

  it('refuses a file of another kind', async () => {
    const was = await hang('a.png')
    const res = await mend(was.path, { file: Buffer.from('<p>'), ext: '.html' })
    expect(res.status).toBe(422)
    expect(await res.text()).toMatch(/pull it and post/)
  })

  it('keeps the old file when the new one will not read', async () => {
    const was = await hang('a.png')
    const res = await mend(was.path, { file: Buffer.from('not a png') })
    expect(res.status).toBe(422)
    expect(await res.text()).toMatch(/kept the old one/)
    expect(store.cardAt(was.path)!.w).toBe(8)
    expect(await sharp(was.path).metadata().then((m) => m.width)).toBe(8)
  })

  it("refuses a take's note, which is the group's", async () => {
    const take = await hang('t1.png', { caption: 't1', group: 'g' })
    const res = await mend(join(root, 'inbox', 'z', 't1.png'), { words: { note: 'n' } })
    expect(take.kind).toBe('group')
    expect(res.status).toBe(422)
  })

  it('needs the token, and answers 404 for a path the wall does not hold', async () => {
    const was = await hang('a.png')
    expect((await mend(was.path, { words: { caption: 'x' }, headers: { Authorization: '' } })).status).toBe(401)
    expect((await mend(join(root, 'inbox', 'z', 'nope.png'), { words: { caption: 'x' } })).status).toBe(404)
  })
})

describe('pull', () => {
  it('sends a card to the trash and says it expired', async () => {
    const was = await hang('a.png')
    expect((await pull(was.path)).status).toBe(200)
    expect(store.cardAt(was.path)).toBeNull()
    expect(existsSync(was.path)).toBe(false)
    expect(await readdir(join(root, 'trash'))).toContain(`${was.id}-z`)
    expect(sent).toContainEqual({ type: 'expire', id: was.id })
  })

  it('takes one take out of its group and leaves the card at its age', async () => {
    await hang('t1.png', { caption: 't1', group: 'g' })
    const group = await hang('t2.png', { caption: 't2', group: 'g' })
    const bornAt = group.bornAt
    const first = join(root, 'inbox', 'z', 't1.png')
    expect((await pull(first)).status).toBe(200)
    const left = store.cardAt(join(root, 'inbox', 'z', 't2.png'))!
    expect(left.takes!.map((t) => t.name)).toEqual(['t2'])
    expect(left.bornAt).toBe(bornAt)
    expect(existsSync(first)).toBe(false)
    expect(amended().at(-1)!.item.takes).toHaveLength(1)
  })
})

describe('mend and pull from a node', () => {
  function run(args: string[]) {
    const child = spawn('sh', [TRANSOM, ...args], {
      env: { ...process.env, TRANSOM_ROOT: node },
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: node,
    })
    let out = ''
    let err = ''
    child.stdout!.on('data', (d) => (out += d))
    child.stderr!.on('data', (d) => (err += d))
    return new Promise<{ code: number | null; out: string; err: string }>((r) => child.on('exit', (code) => r({ code, out, err })))
  }

  it('mends the words and the file, then pulls the card', async () => {
    const was = await hang('a.png')
    await writeFile(join(node, 'next.png'), await png(30))
    const mended = await run(['mend', was.path, 'next.png', '--caption', 'with "quotes"'])
    expect(mended).toMatchObject({ code: 0, out: `${was.path}\n` })
    const now = store.cardAt(was.path)!
    expect(now.name).toBe('with "quotes"')
    expect(now.w).toBe(30)
    expect(now.bornAt).toBe(was.bornAt)

    expect((await run(['pull', was.path])).code).toBe(0)
    expect(store.cardAt(was.path)).toBeNull()
  })

  it('says what the wall refused', async () => {
    const res = await run(['pull', join(root, 'inbox', 'z', 'nope.png')])
    expect(res.code).toBe(1)
    expect(res.err).toMatch(/HTTP 404.*nothing on the wall is at that path/)
  })

  it('says so when the wall is too old to have the routes', async () => {
    const old = express().listen(0)
    await new Promise((r) => old.once('listening', r))
    const a = old.address()
    await writeFile(join(node, 'wall.env'), `TRANSOM_WALL=http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}\nTRANSOM_TOKEN=tok\n`)
    const res = await run(['pull', join(root, 'inbox', 'z', 'a.png')])
    old.close()
    expect(res.code).toBe(1)
    expect(res.err).toMatch(/is older than `transom pull`. Run brew upgrade transom on it/)
  })

  it('refuses a file of another kind before sending it', async () => {
    const was = await hang('a.png')
    await writeFile(join(node, 'next.jpg'), 'x')
    const res = await run(['mend', was.path, 'next.jpg'])
    expect(res.code).toBe(1)
    expect(res.err).toMatch(/holds a \.png, not a \.jpg/)
  })
})

describe('an hour-old card', () => {
  it('comes back at its age after a restart that follows a mend', async () => {
    const path = join(root, 'inbox', 'z', 'old.png')
    await writeFile(`${path}.transom.json`, '{"caption":"old"}')
    await writeFile(path, await png(8))
    const hourAgo = new Date(Date.now() - 3_600_000)
    await utimes(path, hourAgo, hourAgo)
    await vi.waitFor(() => expect(store.cardAt(path)).not.toBeNull(), { timeout: 8000 })
    const bornAt = store.cardAt(path)!.bornAt
    await mend(path, { file: await png(12) })
    expect(Math.abs((await stat(path)).mtimeMs - bornAt)).toBeLessThan(2)
    expect(JSON.parse(await readFile(`${path}.transom.json`, 'utf8')).caption).toBe('old')
  })
})
