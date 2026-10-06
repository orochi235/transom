import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TRANSOM = fileURLToPath(new URL('../bin/transom', import.meta.url))
let wall: string, nodeHome: string, stubs: string

beforeEach(async () => {
  wall = await mkdtemp(join(tmpdir(), 'transom-pair-wall-'))
  nodeHome = await mkdtemp(join(tmpdir(), 'transom-pair-node-'))
  stubs = await mkdtemp(join(tmpdir(), 'transom-pair-bin-'))
  await writeFile(join(wall, 'token'), 'a'.repeat(64) + '\n')
  const stub = async (name: string, body: string) => {
    await writeFile(join(stubs, name), `#!/bin/sh\n${body}\n`)
    await chmod(join(stubs, name), 0o755)
  }
  // pair calls `ssh -o BatchMode=yes HOST CMD`: drop the option and the host,
  // then run the command as the node would, against a temp home.
  await mkdir(join(nodeHome, 'tmp'))
  await stub('ssh', `shift 3; HOME=${nodeHome} TRANSOM_ROOT=${nodeHome}/transom TMPDIR=${nodeHome}/tmp exec sh -c "$*"`)
  // Logs each call; `brew list` says installed while the marker file exists.
  await stub('brew', `echo "$*" >> ${stubs}/brew.log
case "$1" in list) [ -f ${stubs}/installed ] ;; esac`)
  await stub('transom', `exec sh ${TRANSOM} "$@"`)
  // Records its arguments and the headers file it was handed, so the test can
  // check the token stayed out of argv.
  await stub('curl', `echo "$*" > ${stubs}/curl.args
for a; do case "$a" in @*) cat "\${a#@}" > ${stubs}/curl.headers ;; esac; done
echo '{"host":"wall"}'`)
  await stub('scutil', 'echo wallhost')
})
afterEach(async () => {
  for (const d of [wall, nodeHome, stubs]) await rm(d, { recursive: true, force: true })
})

function pair(args: string[]) {
  const child = spawn('sh', [TRANSOM, 'pair', ...args], {
    // wire would link /usr/local/bin/transom when that is on PATH: outside the temp home.
    env: { ...process.env, PATH: `${stubs}:${process.env.PATH}`, TRANSOM_ROOT: wall, TRANSOM_PAIR_NO_WIRE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = '', err = ''
  child.stdout.on('data', (d) => (out += d))
  child.stderr.on('data', (d) => (err += d))
  return new Promise<{ code: number | null; out: string; err: string }>((r) => child.on('exit', (code) => r({ code, out, err })))
}

describe('transom pair', () => {
  it('writes wall.env on the node, readable only by its owner', async () => {
    const { code, err, out } = await pair(['studio'])
    expect(err).toBe('')
    expect(code).toBe(0)
    expect(out).toBe('studio sends to http://wallhost.local:8787\n')
    const env = join(nodeHome, 'transom', 'wall.env')
    expect(await readFile(env, 'utf8')).toBe(`TRANSOM_WALL=http://wallhost.local:8787\nTRANSOM_TOKEN=${'a'.repeat(64)}\n`)
    expect((await stat(env)).mode & 0o777).toBe(0o600)
  })
  it('checks the wall from the node with the token in a file, not in argv', async () => {
    expect((await pair(['studio'])).code).toBe(0)
    const args = await readFile(join(stubs, 'curl.args'), 'utf8')
    expect(args).toContain('http://wallhost.local:8787/api/whoami')
    expect(args).not.toContain('a'.repeat(64))
    expect(await readFile(join(stubs, 'curl.headers'), 'utf8'))
      .toBe(`Authorization: Bearer ${'a'.repeat(64)}\nX-Transom-Protocol: 1\n`)
  })
  it('fails when the node cannot reach the wall', async () => {
    await writeFile(join(stubs, 'curl'), '#!/bin/sh\nexit 7\n')
    const { code, err } = await pair(['studio'])
    expect(code).not.toBe(0)
    expect(err).toContain('cannot reach http://wallhost.local:8787')
  })
  it('installs from HEAD where transom is not installed yet', async () => {
    expect((await pair(['--head', 'studio'])).code).toBe(0)
    expect(await readFile(join(stubs, 'brew.log'), 'utf8')).toContain('install --HEAD orochi235/tap/transom')
  })
  it('reinstalls from HEAD over a release install', async () => {
    await writeFile(join(stubs, 'installed'), '')
    expect((await pair(['--head', 'studio'])).code).toBe(0)
    expect(await readFile(join(stubs, 'brew.log'), 'utf8')).toContain('reinstall --HEAD orochi235/tap/transom')
  })
  it('upgrades a release install, and installs where there is none', async () => {
    await writeFile(join(stubs, 'installed'), '')
    expect((await pair(['studio'])).code).toBe(0)
    expect(await readFile(join(stubs, 'brew.log'), 'utf8')).toContain('upgrade orochi235/tap/transom')
    await rm(join(stubs, 'installed'))
    await rm(join(stubs, 'brew.log'))
    expect((await pair(['studio'])).code).toBe(0)
    expect(await readFile(join(stubs, 'brew.log'), 'utf8')).toContain('install orochi235/tap/transom')
  })
  it("shows brew's own error when the install fails", async () => {
    await writeFile(join(stubs, 'brew'), '#!/bin/sh\ncase "$1" in list) exit 1 ;; esac\necho "Error: no bottle for you" >&2\nexit 1\n')
    const { code, err } = await pair(['studio'])
    expect(code).not.toBe(0)
    expect(err).toContain('Error: no bottle for you')
    expect(err).not.toContain('Publish a release')
  })
  it('says so when the node has no Homebrew', async () => {
    await rm(join(stubs, 'brew'))
    // Hides any real Homebrew from the node's shell.
    await writeFile(join(stubs, 'ssh'), `#!/bin/sh\nshift 3; cmd=$(printf '%s' "$*" | sed 's#/opt/homebrew/bin#/nonexistent#')\nHOME=${nodeHome} PATH=${stubs}:/usr/bin:/bin exec sh -c "$cmd"\n`)
    const { code, err } = await pair(['studio'])
    expect(code).not.toBe(0)
    expect(err).toContain('transom pair: no Homebrew on studio')
  })
  it('leaves no token file on the node when the ssh session drops mid-check', async () => {
    await writeFile(join(stubs, 'curl'), '#!/bin/sh\nkill -HUP $PPID\nexit 0\n')
    await pair(['studio'])
    expect(await readdir(join(nodeHome, 'tmp'))).toEqual([])
  })
  it('refuses on a wall with no token yet', async () => {
    await rm(join(wall, 'token'))
    expect((await pair(['studio'])).code).not.toBe(0)
  })
  it('takes it back out with --off', async () => {
    await pair(['studio'])
    expect(existsSync(join(nodeHome, 'transom', 'wall.env'))).toBe(true)
    expect((await pair(['--off', 'studio'])).code).toBe(0)
    expect(existsSync(join(nodeHome, 'transom', 'wall.env'))).toBe(false)
  })
})
