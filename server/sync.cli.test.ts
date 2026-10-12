import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TRANSOM = fileURLToPath(new URL('../bin/transom', import.meta.url))
const TOKEN = 'tok-sync'

let wall: string   // the wall host's TRANSOM_ROOT
let node: string   // the sender's TRANSOM_ROOT
let server: Server
let url: string

beforeEach(async () => {
  wall = await mkdtemp(join(tmpdir(), 'transom-sync-wall-'))
  node = await mkdtemp(join(tmpdir(), 'transom-sync-node-'))
  process.env.TRANSOM_ROOT = wall
  vi.resetModules()
  const { mountRemote } = await import('./remote.ts')
  const app = express()
  mountRemote(app, { token: TOKEN, trustLoopback: false })
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const a = server.address()
  url = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`
  await writeFile(join(node, 'wall.env'), `TRANSOM_WALL=${url}\nTRANSOM_TOKEN=${TOKEN}\n`)
})
afterEach(async () => {
  server.close()
  delete process.env.TRANSOM_ROOT
  await rm(wall, { recursive: true, force: true })
  await rm(node, { recursive: true, force: true })
})

function sync(args: string[] = []) {
  const child = spawn('sh', [TRANSOM, 'sync', ...args], {
    env: { ...process.env, TRANSOM_ROOT: node },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = '', err = ''
  child.stdout.on('data', (d) => (out += d))
  child.stderr.on('data', (d) => (err += d))
  return new Promise<{ code: number | null; out: string; err: string }>((r) => child.on('exit', (code) => r({ code, out, err })))
}

async function hang(zone: string, name: string, side?: object) {
  await mkdir(join(node, 'inbox', zone), { recursive: true })
  if (side) await writeFile(join(node, 'inbox', zone, `${name}.transom.json`), JSON.stringify(side))
  await writeFile(join(node, 'inbox', zone, name), `bytes of ${name}`)
}

/** What landed in a zone on the wall, as [picture name, sidecar]. */
async function landed(zone: string) {
  const dir = join(wall, 'inbox', zone)
  const names = (await readdir(dir).catch(() => [])).filter((n) => !n.endsWith('.transom.json'))
  return Promise.all(names.map(async (n) => [n, JSON.parse(await readFile(join(dir, `${n}.transom.json`), 'utf8'))] as const))
}

const UUID = 'A0000000-0000-4000-8000-000000000001'

describe('transom sync', () => {
  it('sends a picture with the sidecar it already had, and keeps the local copy', async () => {
    await hang('z', `${UUID}.ttl30m.png`, { repo: 'r', caption: 'the chart', kept: true })
    const { code, out, err } = await sync()
    expect(err).toBe('')
    expect(code).toBe(0)
    expect(out).toBe(`1/1  z/${UUID}.ttl30m.png\nsent 1 to ${url}\n`)
    const [[name, side]] = await landed('z')
    expect(name).toMatch(/\.ttl30m\.png$/)
    expect(await readFile(join(wall, 'inbox', 'z', name), 'utf8')).toBe(`bytes of ${UUID}.ttl30m.png`)
    expect(side).toMatchObject({ repo: 'r', caption: 'the chart', kept: true })
    expect(typeof side.host).toBe('string')
    expect(existsSync(join(node, 'inbox', 'z', `${UUID}.ttl30m.png`))).toBe(true)
  })

  it('sends each file once', async () => {
    await hang('z', `${UUID}.png`)
    expect((await sync()).code).toBe(0)
    const again = await sync()
    expect(again.out).toBe(`nothing to send to ${url}\n`)
    expect(await landed('z')).toHaveLength(1)
  })

  it('sends again to a different wall', async () => {
    await hang('z', `${UUID}.png`)
    await mkdir(join(node, 'synced', 'z'), { recursive: true })
    await writeFile(join(node, 'synced', 'z', `${UUID}.png`), 'http://elsewhere:8787\t/there.png\n')
    expect((await sync()).out).toContain('sent 1')
  })

  it('captions a file written by hand with its own name', async () => {
    await hang('z', 'coverage chart.png')
    expect((await sync()).code).toBe(0)
    expect((await landed('z'))[0]![1].caption).toBe('coverage chart')
  })

  it('carries the zone\'s project, so the wall can color it', async () => {
    const project = join(node, 'project')
    await mkdir(join(node, 'zones'), { recursive: true })
    await mkdir(project)
    await writeFile(join(project, '.hued'), 'bg: "#102030"\n')
    await writeFile(join(node, 'zones', 'z.json'), JSON.stringify({ root: project }))
    await hang('z', `${UUID}.png`)
    expect((await sync()).code).toBe(0)
    expect(JSON.parse(await readFile(join(wall, 'zones', 'z.json'), 'utf8'))).toEqual({ root: project, hued: 'bg: "#102030"\n' })
  })

  it('leaves alone what the wall does not hold, and a sidecar with no picture', async () => {
    await hang('z', 'notes.txt')
    await mkdir(join(node, 'inbox', 'z'), { recursive: true })
    await writeFile(join(node, 'inbox', 'z', `${UUID}.png.transom.json`), '{}')
    expect((await sync()).out).toBe(`nothing to send to ${url}\n`)
  })

  it('sends one zone with --zone, and nothing with --dry', async () => {
    await hang('a', `${UUID}.png`)
    await hang('b', `${UUID}.png`)
    const dry = await sync(['--dry'])
    expect(dry.out).toContain(`would send 2 to ${url}`)
    expect(await landed('a')).toHaveLength(0)
    expect(existsSync(join(node, 'synced'))).toBe(false)
    expect((await sync(['--zone', 'b'])).out).toBe(`1/1  b/${UUID}.png\nsent 1 to ${url}\n`)
    expect(await landed('a')).toHaveLength(0)
    expect(await landed('b')).toHaveLength(1)
  })

  it('drops the marker of a file the inbox no longer holds', async () => {
    await hang('z', `${UUID}.png`)
    expect((await sync()).code).toBe(0)
    await rm(join(node, 'inbox', 'z', `${UUID}.png`))
    await sync()
    expect(existsSync(join(node, 'synced', 'z'))).toBe(false)
  })

  it('reports a refusal, marks nothing, and exits 1', async () => {
    await writeFile(join(node, 'wall.env'), `TRANSOM_WALL=${url}\nTRANSOM_TOKEN=wrong\n`)
    await hang('z', `${UUID}.png`)
    const { code, err } = await sync()
    expect(code).toBe(1)
    expect(err).toContain('refused (HTTP 401)')
    expect(existsSync(join(node, 'synced', 'z', `${UUID}.png`))).toBe(false)
  })

  it('says so on a host that is paired with no wall', async () => {
    await rm(join(node, 'wall.env'))
    const { code, err } = await sync()
    expect(code).toBe(1)
    expect(err).toContain('transom pair')
  })

  it('exits 6 when the wall is not answering', async () => {
    await writeFile(join(node, 'wall.env'), `TRANSOM_WALL=http://127.0.0.1:1\nTRANSOM_TOKEN=${TOKEN}\n`)
    await hang('z', `${UUID}.png`)
    const { code, err } = await sync()
    expect(code).toBe(6)
    expect(err).toContain('not answering, with 1 left to send')
  })
})
