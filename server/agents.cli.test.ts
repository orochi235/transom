import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AGENTS = fileURLToPath(new URL('../libexec/agents', import.meta.url))
const BASE = 'tech.michaelbaker.transom'
let home: string, stubs: string, keg: string, checkout: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'transom-agents-home-'))
  stubs = await mkdtemp(join(tmpdir(), 'transom-agents-bin-'))
  // A keg is libexec with the service's plist beside it; a checkout has none.
  keg = join(await mkdtemp(join(tmpdir(), 'transom-agents-keg-')), 'libexec')
  checkout = await mkdtemp(join(tmpdir(), 'transom-agents-repo-'))
  await mkdir(keg)
  await writeFile(join(keg, '..', `${BASE}.plist`), '')
  const stub = async (name: string, body: string) => {
    await writeFile(join(stubs, name), `#!/bin/sh\n${body}\n`)
    await chmod(join(stubs, name), 0o755)
  }
  // `print LABEL` succeeds while a marker file named for the label exists.
  await stub('launchctl', `echo "$*" >> ${stubs}/launchctl.log
case "$1" in
  print) [ -f "${stubs}/loaded.\${2##*/}" ] ;;
  bootout) rm -f "${stubs}/loaded.\${2##*/}" ;;
esac`)
  await stub('brew', `echo "$*" >> ${stubs}/brew.log`)
  await stub('pkill', 'exit 0')
})
afterEach(async () => {
  for (const d of [home, stubs, join(keg, '..'), checkout]) await rm(d, { recursive: true, force: true })
})

function agents(from: string, verb: string) {
  const child = spawn('sh', [AGENTS, verb], {
    env: { ...process.env, PATH: `${stubs}:${process.env.PATH}`, HOME: home, TRANSOM_HOME: from },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = '', err = ''
  child.stdout.on('data', (d) => (out += d))
  child.stderr.on('data', (d) => (err += d))
  return new Promise<{ code: number | null; out: string; err: string }>((r) => child.on('exit', (code) => r({ code, out, err })))
}

const log = (name: string) => readFile(join(stubs, `${name}.log`), 'utf8').catch(() => '')
const load = (label: string) => writeFile(join(stubs, `loaded.${label}`), '')
const plists = () => readdir(join(home, 'Library', 'LaunchAgents')).catch(() => [])

describe('transom install, from a keg', () => {
  it('hands the wall to brew services and writes no agents of its own', async () => {
    const { code, err } = await agents(keg, 'install')
    expect(err).toBe('')
    expect(code).toBe(0)
    expect(await log('brew')).toBe('services restart transom\n')
    expect(await plists()).toEqual([])
  })
  it('retires the pair of agents an earlier install left', async () => {
    const dir = join(home, 'Library', 'LaunchAgents')
    await mkdir(dir, { recursive: true })
    for (const half of ['daemon', 'client']) {
      await writeFile(join(dir, `${BASE}.${half}.plist`), '')
      await load(`${BASE}.${half}`)
    }
    expect((await agents(keg, 'install')).code).toBe(0)
    expect(await plists()).toEqual([])
    expect(existsSync(join(stubs, `loaded.${BASE}.daemon`))).toBe(false)
    expect(existsSync(join(stubs, `loaded.${BASE}.client`))).toBe(false)
  })
  it.each([
    ['up', 'start'],
    ['down', 'stop'],
  ])('runs `%s` as brew services %s', async (verb, step) => {
    expect((await agents(keg, verb)).code).toBe(0)
    expect(await log('brew')).toBe(`services ${step} transom\n`)
  })
  it('cycles the one service', async () => {
    expect((await agents(keg, 'cycle')).code).toBe(0)
    expect(await log('launchctl')).toMatch(new RegExp(`^kickstart -k gui/\\d+/${BASE}\\n$`))
  })
})

describe('transom install, from a checkout', () => {
  it('writes both agents and leaves brew alone', async () => {
    const { code, out } = await agents(checkout, 'install')
    expect(code).toBe(0)
    expect(out).toBe(`installed: ${BASE}.daemon, ${BASE}.client\n`)
    expect((await plists()).sort()).toEqual([`${BASE}.client.plist`, `${BASE}.daemon.plist`])
    expect(await log('brew')).toBe('')
  })
  it.each(['install', 'up'])('refuses `%s` while brew services runs the wall', async (verb) => {
    await load(BASE)
    const { code, err } = await agents(checkout, verb)
    expect(code).toBe(1)
    expect(err).toContain('brew services stop transom')
    expect(await plists()).toEqual([])
    expect(await log('launchctl')).not.toContain('bootstrap')
  })
})
