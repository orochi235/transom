import express from 'express'
import type { Server } from 'node:http'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { WallItem } from '@shared/protocol.ts'

let server: Server
let url: string
let store: typeof import('../store.ts')
let inbox: string

beforeEach(async () => {
  process.env.TRANSOM_ROOT = '/tmp/transom-to-test'
  process.env.TRANSOM_WALL_URL = 'http://localhost:7750'
  vi.resetModules()
  store = await import('../store.ts')
  inbox = (await import('../config.ts')).config.inbox
  const { mountTo } = await import('./to.ts')
  const app = express()
  mountTo(app)
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const a = server.address()
  url = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`
})
afterEach(async () => {
  server.close()
  await rm('/tmp/transom-to-test', { recursive: true, force: true })
  delete process.env.TRANSOM_ROOT
  delete process.env.TRANSOM_WALL_URL
})

const hang = (zone: string, name: string, id: string) => {
  const sourcePath = join(inbox, zone, name)
  store.add({ item: { id, zone } as WallItem, sourcePath, cachePath: sourcePath })
}
const follow = async (path: string) => (await fetch(url + path, { redirect: 'manual' })).headers.get('location')

test('a sent file redirects to its card, on the host the reader asked', async () => {
  hang('weasel', 'a.png', 'card-1')
  expect(await follow('/to/weasel/a.png')).toBe('http://127.0.0.1:7750/#/weasel/card-1')
})

test('a file the wall does not hold goes to its pile', async () => {
  expect(await follow('/to/weasel/gone.png')).toBe('http://127.0.0.1:7750/#/weasel')
})

test('a name cannot climb out of the inbox', async () => {
  hang('weasel', 'a.png', 'card-1')
  expect(await follow('/to/other/..%2Fweasel%2Fa.png')).toBe('http://127.0.0.1:7750/#/other')
})

const fetchFile = (path: string) => fetch(url + path)

test('a sent file is served by itself, sandboxed like /orig', async () => {
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(join(inbox, 'weasel'), { recursive: true })
  await writeFile(join(inbox, 'weasel', 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  hang('weasel', 'a.svg', 'card-1')
  const res = await fetchFile('/file/weasel/a.svg')
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toMatch(/image\/svg\+xml/)
  expect(res.headers.get('content-security-policy')).toMatch(/^sandbox;/)
  expect(await res.text()).toContain('<svg')
})

test('a take is served by its own name', async () => {
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(join(inbox, 'weasel'), { recursive: true })
  await writeFile(join(inbox, 'weasel', 't2.png'), 'two')
  const take = (id: string, name: string) => ({ id, url: '', origUrl: '', name, path: join(inbox, 'weasel', name), at: 1, w: 1, h: 1 })
  store.addTake(
    { id: 'g', zone: 'weasel', url: '', origUrl: '', path: '', name: 'g', bornAt: 1, w: 1, h: 1 },
    take('t1', 't1.png'),
    { sourcePath: join(inbox, 'weasel', 't1.png'), cachePath: '' },
    {},
  )
  store.addTake(
    { id: 'g', zone: 'weasel', url: '', origUrl: '', path: '', name: 'g', bornAt: 1, w: 1, h: 1 },
    take('t2', 't2.png'),
    { sourcePath: join(inbox, 'weasel', 't2.png'), cachePath: '' },
    {},
  )
  expect(await (await fetchFile('/file/weasel/t2.png')).text()).toBe('two')
})

test('a file the wall does not hold, or a name climbing out, is a 404', async () => {
  hang('weasel', 'a.png', 'card-1')
  expect((await fetchFile('/file/weasel/gone.png')).status).toBe(404)
  expect((await fetchFile('/file/other/..%2Fweasel%2Fa.png')).status).toBe(404)
})
