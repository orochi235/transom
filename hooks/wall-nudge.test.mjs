import { existsSync, mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  candidates, claimRemote, isImage, marksMessage, marksWaiting, message, onWall, pathsInCommand,
  previewHere, pruneRemote, sent, sentRemotely, toNudge, wallEnv,
} from './wall-nudge.mjs'

let dir
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'wall-nudge-')) })
afterEach(() => { delete process.env.TRANSOM_ROOT })

const touch = (name, ageMs = 0) => {
  const p = path.join(dir, name)
  mkdirSync(path.dirname(p), { recursive: true })
  writeFileSync(p, 'x')
  if (ageMs) {
    const t = (Date.now() - ageMs) / 1000
    utimesSync(p, t, t)
  }
  return p
}

describe('isImage', () => {
  it('accepts the raster and vector extensions', () => {
    for (const n of ['a.png', 'a.JPG', 'a.jpeg', 'a.gif', 'a.webp', 'a.svg', 'a.avif']) {
      expect(isImage(n)).toBe(true)
    }
  })
  it('rejects everything else', () => {
    for (const n of ['a.ts', 'a.pdf', 'a.pngx', 'png', null]) expect(isImage(n)).toBe(false)
  })
})

describe('pathsInCommand', () => {
  it('finds a redirect target', () => {
    expect(pathsInCommand('python plot.py > /tmp/chart.png')).toEqual(['/tmp/chart.png'])
  })
  it('finds a flag value and dedupes repeats', () => {
    expect(pathsInCommand('magick in.png -resize 50% out.png && ls out.png'))
      .toEqual(['in.png', 'out.png'])
  })
  it('ignores quoting and pipe characters', () => {
    expect(pathsInCommand('convert "a.png"|cat')).toEqual(['a.png'])
  })
  it('returns nothing for a command with no image', () => {
    expect(pathsInCommand('npm test')).toEqual([])
  })
})

describe('sent', () => {
  it('names what a send put on the wall', () => {
    expect(sent({ tool_name: 'Bash', tool_input: { command: 'transom post --caption "x" /t/a.png b.jpg' } }))
      .toEqual(['/t/a.png', 'b.jpg'])
  })
  it('names nothing for a command that sent nothing', () => {
    expect(sent({ tool_name: 'Bash', tool_input: { command: 'magick in.png out.png' } })).toEqual([])
    expect(sent({ tool_name: 'Read', tool_input: { file_path: '/t/a.png' } })).toEqual([])
  })
})

describe('candidates', () => {
  it('takes an image the agent read', () => {
    expect(candidates({ tool_name: 'Read', tool_input: { file_path: '/t/a.png' } }))
      .toEqual(['/t/a.png'])
  })
  it('ignores a source file the agent read', () => {
    expect(candidates({ tool_name: 'Read', tool_input: { file_path: '/t/a.ts' } })).toEqual([])
  })
  it('takes an image the agent wrote', () => {
    expect(candidates({ tool_name: 'Write', tool_input: { file_path: '/t/a.svg' } }))
      .toEqual(['/t/a.svg'])
  })
  it('stays quiet when the command already sends to the wall', () => {
    expect(candidates({ tool_name: 'Bash', tool_input: { command: 'transom post /tmp/a.png' } }))
      .toEqual([])
    expect(candidates({ tool_name: 'Bash', tool_input: { command: 'gen | transom post' } })).toEqual([])
  })
  it('ignores tools that cannot produce an image', () => {
    expect(candidates({ tool_name: 'Grep', tool_input: { pattern: 'a.png' } })).toEqual([])
  })
})

describe('previewHere', () => {
  it('is false with no .transom.yaml', async () => {
    expect(await previewHere(dir)).toBe(false)
  })
  it('is true for show: preview, from a directory below it', async () => {
    writeFileSync(path.join(dir, '.transom.yaml'), 'show: preview\n')
    mkdirSync(path.join(dir, 'sub'))
    expect(await previewHere(path.join(dir, 'sub'))).toBe(true)
  })
  it('is false for a file that only renames the zone', async () => {
    writeFileSync(path.join(dir, '.transom.yaml'), 'zone: alt\n')
    expect(await previewHere(dir)).toBe(false)
  })
  it('is false for a file with an error, which transom post refuses anyway', async () => {
    writeFileSync(path.join(dir, '.transom.yaml'), 'show: preveiw\n')
    expect(await previewHere(dir)).toBe(false)
  })
  it('stops at the repo root', async () => {
    writeFileSync(path.join(dir, '.transom.yaml'), 'show: preview\n')
    mkdirSync(path.join(dir, 'inner', '.git'), { recursive: true })
    expect(await previewHere(path.join(dir, 'inner'))).toBe(false)
  })
})

describe('onWall', () => {
  it('is true inside the inbox', () => {
    expect(onWall('/s/inbox/zone/a.png', '/s')).toBe(true)
  })
  it('is true for a drawing sent back from the wall', () => {
    expect(onWall('/s/marks/abc.png', '/s')).toBe(true)
  })
  it('is false elsewhere under the wall root', () => {
    expect(onWall('/s/zones/a.png', '/s')).toBe(false)
  })
})

describe('toNudge', () => {
  it('flags a fresh image off the wall', () => {
    const p = touch('a.png')
    expect(toNudge([p], { root: '/s' })).toEqual([p])
  })
  it('skips an image too old to be this command output', () => {
    const p = touch('a.png', 600_000)
    expect(toNudge([p], { root: '/s' })).toEqual([])
  })
  it('skips a path that does not exist', () => {
    expect(toNudge([path.join(dir, 'ghost.png')], { root: '/s' })).toEqual([])
  })
  it('skips one already nudged about', () => {
    const p = touch('a.png')
    expect(toNudge([p], { root: '/s', seen: { [path.resolve(p)]: Date.now() } })).toEqual([])
  })
  it('skips one already on the wall', () => {
    const root = path.join(dir, 'transom')
    const p = touch('transom/inbox/z/a.png')
    expect(toNudge([p], { root })).toEqual([])
  })
})

describe('message', () => {
  it('reads as one image in the singular', () => {
    const m = message(['/repo/chart.png'], '/repo')
    expect(m).toContain('chart.png is only visible to you')
    expect(m).toContain('transom post chart.png')
  })
  it('pluralizes for several', () => {
    const m = message(['/repo/a.png', '/repo/b.png'], '/repo')
    expect(m).toContain('a.png, b.png are only visible to you')
  })
})

describe('marksWaiting', () => {
  it('is true only while the daemon flags the session', () => {
    touch('marks/waiting/abc-123')
    expect(marksWaiting('abc-123', dir)).toBe(true)
    expect(marksWaiting('other', dir)).toBe(false)
  })
  it('is false with no session to look for', () => {
    expect(marksWaiting(undefined, dir)).toBe(false)
    expect(marksWaiting('', dir)).toBe(false)
  })
  it('cannot be pointed outside the flag directory', () => {
    touch('marks/waiting/.._x')
    expect(marksWaiting('../x', dir)).toBe(true)
    expect(marksWaiting('../../etc/passwd', dir)).toBe(false)
  })
})

describe('marksMessage', () => {
  it('names the render, the picture and what was said', () => {
    const m = marksMessage([{ caption: 'the sky', image: '/t/marks/a.png', text: 'bluer' }])
    expect(m).toContain('Your render "the sky" was marked up on the wall')
    expect(m).toContain('/t/marks/a.png — "bluer"')
  })
  it('leaves the text out when there was none', () => {
    expect(marksMessage([{ caption: 'x', image: '/a.png', text: '' }])).toContain('/a.png. Read')
  })
  it('says nothing for nothing claimed', () => {
    expect(marksMessage([])).toBe('')
  })
})

describe('a remote wall', () => {
  const ID = 'a'.repeat(32)

  const serve = async (claimed) => {
    const server = http.createServer((req, res) => {
      if (req.headers.authorization !== 'Bearer tok') { res.statusCode = 401; return res.end() }
      if (req.url === '/api/marks/claim') {
        res.setHeader('Content-Type', 'application/json')
        return res.end(JSON.stringify({ ok: true, claimed }))
      }
      if (req.url === `/api/marks/${ID}.png`) return res.end('PNG')
      res.statusCode = 404
      res.end()
    })
    await new Promise((r) => server.listen(0, r))
    return { server, env: { wall: `http://127.0.0.1:${server.address().port}`, token: 'tok' } }
  }

  it('reads wall.env', () => {
    writeFileSync(path.join(dir, 'wall.env'), 'TRANSOM_WALL=http://w:8787\nTRANSOM_TOKEN=tok\n')
    expect(wallEnv(dir)).toEqual({ wall: 'http://w:8787', token: 'tok' })
  })

  it('has no wall without wall.env', () => {
    expect(wallEnv(dir)).toBe(null)
  })

  it('knows a session sent there, sanitizing its id as the CLI does', () => {
    touch('remote-sessions/a_b')
    expect(sentRemotely('a/b', dir)).toBe(true)
    expect(sentRemotely('other', dir)).toBe(false)
    expect(sentRemotely('', dir)).toBe(false)
  })

  it('claims with the token and keeps a local copy of each drawing', async () => {
    const { server, env } = await serve([{ id: ID, caption: 'c', zone: 'z', image: '/wall/marks/x.png', text: '' }])
    const { claimed: got } = await claimRemote('s1', env, dir)
    server.close()
    expect(got[0].image).toBe(path.join(dir, 'marks', 'remote', `${ID}.png`))
    expect(readFileSync(got[0].image, 'utf8')).toBe('PNG')
  })

  it('skips a claimed id that is not a plain hash, writing nothing outside marks/', async () => {
    const { server, env } = await serve([{ id: '../../evil', caption: 'c', zone: 'z', image: '/x.png', text: '' }])
    const { claimed: got } = await claimRemote('s1', env, dir)
    server.close()
    expect(got).toEqual([])
    expect(existsSync(path.join(dir, '..', 'evil.png'))).toBe(false)
  })

  it('forgets session markers and drawings after a day', () => {
    touch('remote-sessions/s1')
    touch('marks/remote/abc.png')
    touch('marks/own.json')
    pruneRemote(dir, Date.now() + 25 * 3_600_000)
    expect(existsSync(path.join(dir, 'remote-sessions', 's1'))).toBe(false)
    expect(existsSync(path.join(dir, 'marks', 'remote', 'abc.png'))).toBe(false)
    expect(existsSync(path.join(dir, 'marks', 'own.json'))).toBe(true)
  })

  it('announces a drawing that will not download by its wall URL, writing nothing', async () => {
    const id = 'b'.repeat(32)
    const { server, env } = await serve([{ id, caption: 'c', zone: 'z', image: '/x.png', text: '' }])
    const { claimed: got } = await claimRemote('s1', env, dir)
    server.close()
    expect(got[0].image).toBe(`${env.wall}/api/marks/${id}.png`)
    expect(existsSync(path.join(dir, 'marks', 'remote', `${id}.png`))).toBe(false)
  })

  it('returns every claimed drawing when only one fails to download', async () => {
    const bad = 'b'.repeat(32)
    const { server, env } = await serve([
      { id: bad, caption: 'c', zone: 'z', image: '/x.png', text: '' },
      { id: ID, caption: 'c', zone: 'z', image: '/y.png', text: '' },
    ])
    const { claimed: got } = await claimRemote('s1', env, dir)
    server.close()
    expect(got.map((c) => c.image)).toEqual([
      `${env.wall}/api/marks/${bad}.png`,
      path.join(dir, 'marks', 'remote', `${ID}.png`),
    ])
  })

  it('leaves a wall that did not answer alone for 30 seconds', async () => {
    let hits = 0
    const server = http.createServer((req) => { hits++; req.socket.destroy() })
    await new Promise((r) => server.listen(0, r))
    const env = { wall: `http://127.0.0.1:${server.address().port}`, token: 'tok' }
    expect(await claimRemote('s1', env, dir)).toEqual({ claimed: [], notice: '' })
    expect(await claimRemote('s1', env, dir)).toEqual({ claimed: [], notice: '' })
    server.close()
    expect(hits).toBe(1)
    expect(sentRemotely('.wall-down', dir)).toBe(false)
  })

  const refusing = async (status) => {
    let hits = 0
    const server = http.createServer((_req, res) => {
      hits++
      res.statusCode = status
      res.setHeader('Content-Type', 'text/plain')
      res.end('transom: no\n')
    })
    await new Promise((r) => server.listen(0, r))
    return { server, env: { wall: `http://127.0.0.1:${server.address().port}`, token: 'stale' }, hits: () => hits }
  }

  it('tells the session once when the wall refuses its token', async () => {
    const { server, env, hits } = await refusing(401)
    const first = await claimRemote('s1', env, dir)
    const second = await claimRemote('s1', env, dir)
    server.close()
    expect(first.claimed).toEqual([])
    expect(first.notice).toContain(`the wall at ${env.wall} refused this host's token`)
    expect(first.notice).toContain('transom pair')
    expect(second).toEqual({ claimed: [], notice: '' })
    expect(hits()).toBe(1)
    expect(sentRemotely('.wall-refused', dir)).toBe(false)
  })

  it('tells the session to upgrade when the wall speaks another protocol', async () => {
    const { server, env } = await refusing(426)
    const { notice } = await claimRemote('s1', env, dir)
    server.close()
    expect(notice).toContain('brew upgrade transom')
  })

  it('keeps recent ones', () => {
    touch('remote-sessions/s1')
    pruneRemote(dir, Date.now() + 3_600_000)
    expect(existsSync(path.join(dir, 'remote-sessions', 's1'))).toBe(true)
  })
})
