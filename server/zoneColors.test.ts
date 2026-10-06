import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let transomRoot: string
let projects: string

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'transom-zones-'))
  transomRoot = join(base, 'transom')
  projects = join(base, 'src')
  await mkdir(join(transomRoot, 'zones'), { recursive: true })
  await mkdir(projects, { recursive: true })
  vi.resetModules()
  process.env.TRANSOM_ROOT = transomRoot
})

afterEach(() => {
  delete process.env.TRANSOM_ROOT
})

async function project(name: string, hued?: string) {
  const root = join(projects, name)
  await mkdir(root, { recursive: true })
  if (hued !== undefined) await writeFile(join(root, '.hued'), hued)
  await writeFile(join(transomRoot, 'zones', `${name}.json`), JSON.stringify({ root }))
  return root
}

async function read() {
  const { readZoneColors } = await import('./zoneColors.ts')
  return readZoneColors()
}

test('takes a zone color from the recorded project .hued', async () => {
  await project('weasel', 'background=#1b2a41  # navy\n')
  expect(await read()).toEqual({ weasel: '#1b2a41' })
})

test('a zone whose project has no .hued has no entry', async () => {
  await project('weasel', 'background=#1b2a41  # navy\n')
  await project('wod')
  expect(await read()).toEqual({ weasel: '#1b2a41' })
})

test('a record pointing at a directory that no longer exists is skipped', async () => {
  await writeFile(
    join(transomRoot, 'zones', 'ghost.json'),
    JSON.stringify({ root: join(projects, 'gone') }),
  )
  expect(await read()).toEqual({})
})

test('an unparseable record does not lose the other zones', async () => {
  await project('weasel', 'background=#1b2a41  # navy\n')
  await writeFile(join(transomRoot, 'zones', 'half-written.json'), '{"root":')
  expect(await read()).toEqual({ weasel: '#1b2a41' })
})

test('no zones directory yields no colors rather than throwing', async () => {
  process.env.TRANSOM_ROOT = join(transomRoot, 'nonexistent')
  await expect(read()).resolves.toEqual({})
})

test("takes a zone icon from the .hued's sfkey, apart from its color", async () => {
  await project('weasel', 'background=#1b2a41\nsfkey=hare  # an SF Symbol\n')
  await project('wod', 'background=#222222\n')
  const { readZoneColors, readZoneIcons } = await import('./zoneColors.ts')
  expect(await readZoneIcons()).toEqual({ weasel: 'hare' })
  expect(await readZoneColors()).toEqual({ weasel: '#1b2a41', wod: '#222222' })
})

test('takes the color from the record when the sender sent its .hued', async () => {
  await writeFile(
    join(transomRoot, 'zones', 'remote.json'),
    JSON.stringify({ root: join(projects, 'does-not-exist'), hued: 'background=#1b2a41  # navy\n' }),
  )
  expect(await read()).toEqual({ remote: '#1b2a41' })
})
