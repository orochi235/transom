import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TRANSOM = fileURLToPath(new URL('../bin/transom', import.meta.url))

let wall: string
let repo: string

beforeEach(async () => {
  wall = await mkdtemp(join(tmpdir(), 'transom-wall-'))
  // Real, because git reports the repo root through /private on macOS.
  repo = await realpath(await mkdtemp(join(tmpdir(), 'transom-repo-')))
  spawnSync('git', ['init', '-q', repo])
  await writeFile(join(repo, 'shot.png'), 'png')
})

afterEach(async () => {
  await rm(wall, { recursive: true, force: true })
  await rm(repo, { recursive: true, force: true })
})

/** `transom` run from inside the repo, against a scratch wall. `open` is a
 *  recorder, so a preview never reaches the screen. */
async function run(args: string[], env: Record<string, string> = {}) {
  const opened = join(wall, 'opened')
  const opener = join(wall, 'open')
  await writeFile(opener, `#!/bin/sh\necho "$@" >> '${opened}'\n`)
  await chmod(opener, 0o755)
  const child = spawn('sh', [TRANSOM, ...args], {
    cwd: repo,
    env: { ...process.env, TRANSOM_ROOT: wall, TRANSOM_OPEN: opener, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  let err = ''
  child.stdout.on('data', (d) => (out += d))
  child.stderr.on('data', (d) => (err += d))
  const code = await new Promise<number | null>((r) => child.on('exit', r))
  const sent = out.trim().split('\n').filter(Boolean)
  return { code, out, err, sent, opened: await readFile(opened, 'utf8').catch(() => '') }
}

const settings = (yaml: string) => writeFile(join(repo, '.transom.yaml'), yaml)
const sidecar = async (path: string) => JSON.parse(await readFile(`${path}.transom.json`, 'utf8'))

describe('transom post with a .transom.yaml', () => {
  it('sends to the zone and with the lifetime the file names', async () => {
    await settings('zone: icons\ndefaults:\n  ttl: 30m\n')
    const { code, sent } = await run(['post', 'shot.png'])
    expect(code).toBe(0)
    expect(sent[0]).toMatch(new RegExp(`${wall}/inbox/icons/[^/]+\\.ttl30m\\.png$`))
  })

  it('prints a link to the card on this host\'s daemon, apart from the path', async () => {
    const { sent, err } = await run(['post', '--zone', 'my zone', 'shot.png'], { TRANSOM_PORT: '8799' })
    expect(sent).toHaveLength(1)
    expect(err.trim()).toBe(`wall: http://localhost:8799/to/%6d%79%20%7a%6f%6e%65/${sent[0]!.split('/').pop()}`)
  })

  it('lets a flag beat the file', async () => {
    await settings('zone: icons\ndefaults:\n  ttl: 30m\n')
    const { sent } = await run(['post', '--zone', 'other', '--ttl', '5m', 'shot.png'])
    expect(sent[0]).toMatch(/\/inbox\/other\/[^/]+\.ttl5m\.png$/)
  })

  it('offers the file\'s apps, with paths from the repo root', async () => {
    await settings('defaults:\n  apps:\n    - LDView\n    - { name: Studio, path: parts/3001.dat }\n')
    const { sent } = await run(['post', 'shot.png'])
    const { apps } = await sidecar(sent[0]!)
    expect(apps).toEqual([
      { name: 'LDView', path: sent[0] },
      { name: 'Studio', path: join(repo, 'parts/3001.dat') },
    ])
  })

  it('lowers attention to the loudest the repo allows, and can silence it', async () => {
    await settings('attention:\n  loudest: soon\n  sound: false\n')
    const { sent } = await run(['post', '--attention', 'problem:10m', 'shot.png'])
    const stamp = await sidecar(sent[0]!)
    expect(stamp.attention).toBe('soon:10m')
    expect(stamp.quiet).toBe(true)
  })

  it('opens the file locally for show: preview, and sends nothing', async () => {
    await settings('show: preview\n')
    const { code, sent, opened } = await run(['post', 'shot.png'])
    expect(code).toBe(0)
    expect(sent).toEqual([])
    expect(opened.trim()).toBe('shot.png')
    expect(await readdir(wall)).not.toContain('inbox')
  })

  it('refuses to ask where there is no card to ask on', async () => {
    await settings('show: preview\n')
    const { code, err } = await run(['ask', 'which?', 'shot.png'])
    expect(code).toBe(1)
    expect(err).toMatch(/Preview/)
  })

  it('stops the send and names every error in a broken file', async () => {
    await settings('zone: 1.10\ndefaults:\n  tll: 3m\n')
    const { code, err, sent } = await run(['post', 'shot.png'])
    expect(code).toBe(1)
    expect(sent).toEqual([])
    expect(err).toMatch(/\/zone: must be string/)
    expect(err).toMatch(/\/defaults\/tll: not a setting/)
  })

  it('reports the zone the file names', async () => {
    await settings('zone: icons\n')
    expect((await run(['zone'])).out.trim()).toBe('icons')
  })
})

describe('transom wire --repo', () => {
  it('writes the starter, then checks it, then removes it untouched', async () => {
    expect((await run(['wire', '--repo'])).code).toBe(0)
    const written = await readFile(join(repo, '.transom.yaml'), 'utf8')
    expect(written).toMatch(/^# yaml-language-server: \$schema=/)
    expect((await run(['wire', '--repo'])).out).toMatch(/is valid/)
    expect((await run(['wire', '--repo', '--off'])).out).toMatch(/removed/)
    expect(await readdir(repo)).not.toContain('.transom.yaml')
  })

  it('names the errors in a file it finds broken', async () => {
    await settings('show: preveiw\n')
    const { code, out } = await run(['wire', '--repo'])
    expect(code).toBe(1)
    expect(out).toMatch(/\/show: must be equal to one of the allowed values/)
  })

  it('will not remove a file someone edited', async () => {
    await settings('zone: icons\n')
    expect((await run(['wire', '--repo', '--off'])).out).toMatch(/has been edited/)
    expect(await readdir(repo)).toContain('.transom.yaml')
  })
})
