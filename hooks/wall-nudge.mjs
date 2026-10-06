#!/usr/bin/env node
// PostToolUse on Read|Write|Bash: catch an image the agent just made or looked
// at that never reached the wall, and hand the session any render of its own
// that was marked up on the wall since its last tool call. Exits 2 with the
// message on stderr, which Claude Code feeds back to the model.
//
// Prose in CLAUDE.md loses to the harness telling every session to write
// generated files into its scratchpad; this fires after the fact, when the fix
// is one command.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import path from 'node:path'

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|tiff?|avif)$/i

// A file older than this was not made by the command that mentioned it.
const FRESH_MS = 120_000
const SEEN_TTL_MS = 3_600_000

export const transomRoot = () => process.env.TRANSOM_ROOT || path.join(homedir(), 'transom')

export function isImage(p) {
  return typeof p === 'string' && IMAGE_EXT.test(p)
}

/** Already on the wall: nudging about it would be the second nudge. */
export function onWall(p, root = transomRoot()) {
  const abs = path.resolve(p)
  // `marks/` too: a drawing sent back from the wall came from there, and
  // nudging to post it would put the correction on the wall as a new card.
  return ['inbox', 'marks'].some((d) => abs.startsWith(path.join(root, d) + path.sep))
}

/** Image-looking paths named anywhere in a shell command. */
export function pathsInCommand(cmd) {
  if (typeof cmd !== 'string') return []
  const out = []
  for (const m of cmd.matchAll(/[^\s'"`|<>()]+\.(?:png|jpe?g|gif|webp|svg|bmp|tiff?|avif)\b/gi)) {
    out.push(m[0])
  }
  return [...new Set(out)]
}

/** The images a command sent to the wall itself, or asked a question with. */
export function sent(payload) {
  const cmd = payload?.tool_input?.command
  if (payload?.tool_name !== 'Bash' || !/\btransom\b/.test(cmd ?? '')) return []
  return pathsInCommand(cmd)
}

/** Paths the tool call put in front of us that we should judge. */
export function candidates(payload) {
  const tool = payload?.tool_name
  const input = payload?.tool_input ?? {}
  if (tool === 'Read' || tool === 'Write') {
    return isImage(input.file_path) ? [input.file_path] : []
  }
  if (tool === 'Bash') {
    if (/\btransom\b/.test(input.command ?? '')) return []
    return pathsInCommand(input.command)
  }
  return []
}

/** A repo whose `.transom.yaml` says `show: preview` keeps its renders local.
 *  The parser loads only when there is a file, so a repo without one costs
 *  this hook nothing; a node that cannot load it nudges as before. */
export async function previewHere(cwd) {
  if (!cwd) return false
  for (let at = path.resolve(cwd); ; at = path.dirname(at)) {
    const file = path.join(at, '.transom.yaml')
    if (existsSync(file)) {
      try {
        const { parseRepoSettings } = await import('../shared/repoSettings.ts')
        return parseRepoSettings(readFileSync(file, 'utf8')).settings.show === 'preview'
      } catch {
        return false
      }
    }
    if (existsSync(path.join(at, '.git')) || path.dirname(at) === at) return false
  }
}

function seenPath() { return path.join(transomRoot(), 'wall-nudge-seen.json') }

export function readSeen(now = Date.now(), file = seenPath()) {
  let raw
  try { raw = JSON.parse(readFileSync(file, 'utf8')) } catch { return {} }
  if (!raw || typeof raw !== 'object') return {}
  const kept = {}
  for (const [k, t] of Object.entries(raw)) {
    if (typeof t === 'number' && now - t < SEEN_TTL_MS) kept[k] = t
  }
  return kept
}

function writeSeen(seen, file = seenPath()) {
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(seen))
  } catch { /* the nudge is worth more than the bookkeeping */ }
}

/** Images worth nudging about: real, fresh, off the wall, not already flagged. */
export function toNudge(paths, { now = Date.now(), seen = {}, root = transomRoot() } = {}) {
  const hits = []
  for (const p of paths) {
    const abs = path.resolve(p)
    if (onWall(abs, root)) continue
    if (seen[abs]) continue
    let st
    try { st = statSync(abs) } catch { continue }
    if (!st.isFile() || now - st.mtimeMs > FRESH_MS) continue
    hits.push(abs)
  }
  return hits
}

/** The flag the daemon keeps while a drawing waits for this session: one
 *  `stat` on every tool call, and a request to the daemon only when it is set. */
export function marksWaiting(session, root = transomRoot()) {
  if (typeof session !== 'string' || session === '') return false
  return existsSync(path.join(root, 'marks', 'waiting', session.replace(/[^A-Za-z0-9._-]/g, '_')))
}

/** Collects what is waiting, which the daemon marks delivered as it hands it
 *  over. Nothing when the daemon is not answering: the drawing stays pending
 *  on the wall, and the next tool call asks again. */
export async function claimMarks(session, port = process.env.TRANSOM_PORT || 8787) {
  try {
    const res = await fetch(`http://localhost:${port}/api/marks/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
      signal: AbortSignal.timeout(2000),
    })
    const body = await res.json()
    return Array.isArray(body?.claimed) ? body.claimed : []
  } catch {
    return []
  }
}

const DAY_MS = 86_400_000
const MARK_ID = /^[0-9a-f]{32}$/

/** The wall this host sends to, from the file `transom pair` wrote, or null. */
export function wallEnv(root = transomRoot()) {
  try {
    const text = readFileSync(path.join(root, 'wall.env'), 'utf8')
    const get = (k) => new RegExp(`^${k}=(.*)$`, 'm').exec(text)?.[1]?.trim()
    const wall = get('TRANSOM_WALL')
    const token = get('TRANSOM_TOKEN')
    return wall && token ? { wall, token } : null
  } catch {
    return null
  }
}

const WALL_DOWN = '.wall-down'
const WALL_REFUSED = '.wall-refused'
const SKIP_MS = 30_000

export function sentRemotely(session, root = transomRoot()) {
  if (typeof session !== 'string' || session === '') return false
  const name = session.replace(/[^A-Za-z0-9._-]/g, '_')
  return name !== WALL_DOWN && name !== WALL_REFUSED && existsSync(path.join(root, 'remote-sessions', name))
}

const fresh = (marker) => {
  try {
    return Date.now() - statSync(marker).mtimeMs < SKIP_MS
  } catch {
    return false
  }
}

const mark = (marker) => {
  try {
    mkdirSync(path.dirname(marker), { recursive: true })
    writeFileSync(marker, '')
  } catch { /* the marker only saves time */ }
}

/** What the session is told when the wall turns this host away. */
export function refusal(status, wall) {
  if (status === 401)
    return `transom: the wall at ${wall} refused this host's token — run \`transom pair ${hostname().replace(/\.local$/, '')}\` on the wall.\n`
  return `transom: the wall at ${wall} speaks a different protocol — run \`brew upgrade transom\` on this host.\n`
}

/** Claims from the wall host, and swaps each drawing's path there for a copy
 *  here — the session cannot read the wall host's disk. An id that is not a
 *  plain hash is skipped: it becomes a filename here. A drawing that will not
 *  download is still returned, pointing at the wall, because the claim already
 *  marked it delivered. After the wall fails to answer or turns the token
 *  away, it is left alone for 30 seconds so each tool call does not ask again;
 *  a refusal comes back as `notice`, for the session to read. */
export async function claimRemote(session, env, root = transomRoot()) {
  const down = path.join(root, 'remote-sessions', WALL_DOWN)
  const refused = path.join(root, 'remote-sessions', WALL_REFUSED)
  if (fresh(down) || fresh(refused)) return { claimed: [], notice: '' }
  const headers = { Authorization: `Bearer ${env.token}`, 'X-Transom-Protocol': '1' }
  let claimed
  try {
    const res = await fetch(`${env.wall}/api/marks/claim`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
      signal: AbortSignal.timeout(2000),
    })
    rmSync(down, { force: true })
    if (res.status === 401 || res.status === 426) {
      mark(refused)
      return { claimed: [], notice: refusal(res.status, env.wall) }
    }
    rmSync(refused, { force: true })
    const body = await res.json()
    claimed = Array.isArray(body?.claimed) ? body.claimed : []
  } catch {
    mark(down)
    return { claimed: [], notice: '' }
  }
  const dir = path.join(root, 'marks', 'remote')
  const kept = []
  for (const c of claimed) {
    if (typeof c?.id !== 'string' || !MARK_ID.test(c.id)) continue
    const url = `${env.wall}/api/marks/${c.id}.png`
    try {
      const png = await fetch(url, { headers, signal: AbortSignal.timeout(5000) })
      const bytes = Buffer.from(await png.arrayBuffer())
      if (!png.ok || bytes.length === 0) throw new Error(`HTTP ${png.status}`)
      mkdirSync(dir, { recursive: true })
      const local = path.join(dir, `${c.id}.png`)
      writeFileSync(local, bytes)
      c.image = local
    } catch {
      c.image = url
    }
    kept.push(c)
  }
  return { claimed: kept, notice: '' }
}

/** Forgets only what this hook wrote; the local daemon's own marks/ records
 *  are its to keep. */
export function pruneRemote(root = transomRoot(), now = Date.now()) {
  for (const dir of ['remote-sessions', path.join('marks', 'remote')]) {
    let names = []
    try { names = readdirSync(path.join(root, dir)) } catch { continue }
    for (const n of names) {
      const p = path.join(root, dir, n)
      try {
        const st = statSync(p)
        if (st.isFile() && Math.max(st.mtimeMs, st.ctimeMs) < now - DAY_MS) rmSync(p)
      } catch { /* gone already, or not ours to remove */ }
    }
  }
}

export function marksMessage(claimed) {
  return claimed
    .map((c) => {
      const said = c.text ? ` — "${c.text}"` : ''
      return (
        `Your render "${c.caption}" was marked up on the wall ("No, like this"): ${c.image}${said}. ` +
        `Read the picture and take the marks as the correction.\n`
      )
    })
    .join('')
}

export function message(hits, cwd) {
  const names = hits.map((h) => path.relative(cwd || process.cwd(), h) || h)
  const one = names.length === 1
  return (
    `${names.join(', ')} ${one ? 'is' : 'are'} only visible to you. ` +
    `Put ${one ? 'it' : 'them'} on the transom wall now — ` +
    `\`transom post ${names.join(' ')}\` (or \`~/src/transom/bin/transom\` if it is not on PATH) — ` +
    `then say which zone ${one ? 'it' : 'they'} went to. Do not \`open\` renders in Preview.\n`
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let raw = ''
  for await (const c of process.stdin) raw += c
  let p; try { p = JSON.parse(raw) } catch { process.exit(0) }

  const now = Date.now()
  const seen = readSeen(now)
  // A send counts as seen, or reading the same file afterwards is nudged as
  // though it had never reached the wall.
  const posted = sent(p)
  if (posted.length > 0) {
    for (const s of posted) seen[path.resolve(p?.cwd ?? process.cwd(), s)] = now
    writeSeen(seen)
  }

  const env = sentRemotely(p?.session_id) ? wallEnv() : null
  if (env) pruneRemote()
  const { claimed, notice } = env
    ? await claimRemote(p.session_id, env)
    : { claimed: marksWaiting(p?.session_id) ? await claimMarks(p.session_id) : [], notice: '' }
  const marked = notice + marksMessage(claimed)

  const paths = candidates(p)
  const hits = paths.length > 0 && !(await previewHere(p?.cwd)) ? toNudge(paths, { now, seen }) : []
  if (hits.length > 0) {
    for (const h of hits) seen[h] = now
    writeSeen(seen)
  }

  const out = marked + (hits.length > 0 ? message(hits, p?.cwd) : '')
  if (out === '') process.exit(0)
  process.stderr.write(out)
  process.exit(2)
}
