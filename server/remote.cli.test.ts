import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROTOCOL } from '@shared/remote.ts'

const TRANSOM = fileURLToPath(new URL('../bin/transom', import.meta.url))
// Distinctive, so finding it in `ps` cannot be a coincidence.
const TOKEN = `tok-${Math.random().toString(36).slice(2)}`

let wall: string   // the wall host's TRANSOM_ROOT
let node: string   // the sender's TRANSOM_ROOT
let server: Server
let url: string

beforeEach(async () => {
  wall = await mkdtemp(join(tmpdir(), 'transom-wall-'))
  node = await mkdtemp(join(tmpdir(), 'transom-node-'))
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
  await writeFile(join(node, 'shot.png'), 'png')
})
afterEach(async () => {
  server.close()
  await rm(wall, { recursive: true, force: true })
  await rm(node, { recursive: true, force: true })
})

function run(args: string[], env: Record<string, string> = {}, input?: string) {
  const child = spawn('sh', [TRANSOM, ...args], {
    env: { ...process.env, TRANSOM_ROOT: node, TRANSOM_ZONE: 'z', CLAUDE_CODE_SESSION_ID: 'sess-1', ...env },
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    cwd: node,
  })
  if (input !== undefined) child.stdin!.end(input)
  let out = ''
  let err = ''
  child.stdout!.on('data', (d) => (out += d))
  child.stderr!.on('data', (d) => (err += d))
  return new Promise<{ code: number | null; out: string; err: string }>((r) =>
    child.on('exit', (code) => r({ code, out, err })),
  )
}

describe('remote mode', () => {
  it('agrees with the daemon on the protocol', async () => {
    expect((await run(['protocol'])).out.trim()).toBe(String(PROTOCOL))
  })

  it('posts to the wall host and prints where it landed there', async () => {
    const { code, out } = await run(['post', '--caption', 'hi', 'shot.png'])
    expect(code).toBe(0)
    const path = out.trim()
    expect(path.startsWith(join(wall, 'inbox', 'z'))).toBe(true)
    expect(await readFile(path, 'utf8')).toBe('png')
    const side = JSON.parse(await readFile(`${path}.transom.json`, 'utf8'))
    expect(side.caption).toBe('hi')
    expect(typeof side.host).toBe('string')
    expect(side.session).toBe('sess-1')
  })

  it('marks the session as one that sent remotely, for the hook', async () => {
    await run(['post', 'shot.png'])
    await expect(readFile(join(node, 'remote-sessions', 'sess-1'), 'utf8')).resolves.toBe('')
  })

  it('asks across hosts and prints the answer', async () => {
    const child = run(['ask', 'which?', '--choice', 'left', 'shot.png'])
    // Play the store: answer once the image lands on the wall host.
    for (;;) {
      const dir = join(wall, 'inbox', 'z')
      const { readdirSync, existsSync } = await import('node:fs')
      const sent = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith('.png')) : undefined
      if (sent) {
        await mkdir(join(wall, 'answers'), { recursive: true })
        await writeFile(join(wall, 'answers', sent), 'answered\nleft\n')
        break
      }
      await new Promise((r) => setTimeout(r, 50))
    }
    const { code, out } = await child
    expect(code).toBe(0)
    expect(out.trim().split('\n').pop()).toBe('left')
  })

  it('keeps waiting through a wall that drops off mid-question', async () => {
    const child = run(['ask', 'which?', 'shot.png'])
    let sent: string | undefined
    const { readdirSync, existsSync } = await import('node:fs')
    while (!sent) {
      const dir = join(wall, 'inbox', 'z')
      sent = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith('.png')) : undefined
      await new Promise((r) => setTimeout(r, 50))
    }
    server.close()
    server.closeAllConnections()
    await new Promise((r) => setTimeout(r, 1500))
    const port = Number(new URL(url).port)
    const { mountRemote } = await import('./remote.ts')
    const app = express()
    mountRemote(app, { token: TOKEN, trustLoopback: false })
    server = app.listen(port)
    await mkdir(join(wall, 'answers'), { recursive: true })
    await writeFile(join(wall, 'answers', sent), 'answered\n\nfine\n')
    const { code, out } = await child
    expect(code).toBe(0)
    expect(out.trim().split('\n').pop()).toBe('fine')
  }, 20_000)

  it('exits 6 when the wall is not answering', async () => {
    await writeFile(join(node, 'wall.env'), 'TRANSOM_WALL=http://127.0.0.1:1\nTRANSOM_TOKEN=tok\n')
    const { code, err } = await run(['post', 'shot.png'])
    expect(code).toBe(6)
    expect(err).toContain('the wall at http://127.0.0.1:1 is not answering')
  })

  it('drops an --app that names a file on this host, and keeps a bare one', async () => {
    const { out, err } = await run(['post', '--app', 'Preview', '--app', 'LDView=parts/x.dat', 'shot.png'])
    const side = JSON.parse(await readFile(`${out.trim()}.transom.json`, 'utf8'))
    expect(side.apps).toEqual([{ name: 'Preview', path: out.trim() }])
    expect(err).toContain('LDView')
  })

  it('sends piped bytes as a .png', async () => {
    const { code, out } = await run(['post', '--caption', 'piped'], {}, 'piped bytes')
    expect(code).toBe(0)
    const path = out.trim()
    expect(path.startsWith(join(wall, 'inbox', 'z'))).toBe(true)
    expect(path.endsWith('.png')).toBe(true)
    expect(await readFile(path, 'utf8')).toBe('piped bytes')
  })

  it('refuses a card too long for the header, rather than blaming the wall', async () => {
    const { code, err } = await run(['post', '--note', 'x'.repeat(20000), 'shot.png'])
    expect(code).toBe(1)
    expect(err).toContain("the card's text is too long to send to a remote wall")
  })

  it('refuses a zone the URL cannot carry', async () => {
    const { code, err } = await run(['post', '--zone', 'a b', 'shot.png'])
    expect(code).toBe(1)
    expect(err).toContain('a remote wall takes a zone of')
  })

  it('keeps the token out of argv while an ask waits', async () => {
    const child = run(['ask', 'which?', 'shot.png'])
    const { readdirSync, existsSync } = await import('node:fs')
    const { execFileSync } = await import('node:child_process')
    let sent: string | undefined
    while (!sent) {
      const dir = join(wall, 'inbox', 'z')
      sent = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith('.png')) : undefined
      await new Promise((r) => setTimeout(r, 50))
    }
    let polling = false
    for (let i = 0; i < 10; i++) {
      const ps = execFileSync('ps', ['-ax', '-o', 'args']).toString()
      expect(ps).not.toContain(TOKEN)
      if (ps.includes(`/api/answers/${sent}`)) polling = true
      await new Promise((r) => setTimeout(r, 100))
    }
    expect(polling).toBe(true)
    await mkdir(join(wall, 'answers'), { recursive: true })
    await writeFile(join(wall, 'answers', sent), 'answered\n\nok\n')
    expect((await child).code).toBe(0)
  }, 10_000)
})

describe('libexec/remote.sh agrees with the daemon', () => {
  it('holds the same protocol number', () => {
    const script = readFileSync(fileURLToPath(new URL('../libexec/remote.sh', import.meta.url)), 'utf8')
    const line = script.match(/^TRANSOM_PROTOCOL=(\d+)$/m)
    expect(line, 'TRANSOM_PROTOCOL not found in libexec/remote.sh').not.toBe(null)
    expect(Number(line![1])).toBe(PROTOCOL)
  })
})
