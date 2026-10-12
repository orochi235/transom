import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mountPage } from './page.ts'

let dir: string
let server: Server | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'transom-page-'))
})
afterEach(async () => {
  server?.close()
  server = undefined
  await rm(dir, { recursive: true, force: true })
})

async function serve(app: express.Express): Promise<string> {
  server = app.listen(0, '127.0.0.1')
  await new Promise((r) => server!.once('listening', r))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe('mountPage', () => {
  it('serves the build at the root and its assets beside it', async () => {
    await writeFile(join(dir, 'index.html'), '<title>wall</title>')
    await mkdir(join(dir, 'assets'))
    await writeFile(join(dir, 'assets', 'index-abc.js'), 'export {}')
    const app = express()
    expect(mountPage(app, dir)).toBe(true)
    const base = await serve(app)
    expect(await (await fetch(`${base}/`)).text()).toBe('<title>wall</title>')
    expect((await fetch(`${base}/assets/index-abc.js`)).status).toBe(200)
  })

  it('leaves a route mounted before it alone', async () => {
    await writeFile(join(dir, 'index.html'), '<title>wall</title>')
    await mkdir(join(dir, 'api'))
    await writeFile(join(dir, 'api', 'health'), 'from the build')
    const app = express()
    app.get('/api/health', (_req, res) => void res.json({ ok: true }))
    mountPage(app, dir)
    const base = await serve(app)
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: true })
  })

  it('mounts nothing where there is no build', async () => {
    const app = express()
    expect(mountPage(app, dir)).toBe(false)
    const base = await serve(app)
    expect((await fetch(`${base}/`)).status).toBe(404)
  })
})
