import express from 'express'
import type { Server } from 'node:http'
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
afterEach(() => {
  server.close()
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
