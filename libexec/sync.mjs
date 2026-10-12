#!/usr/bin/env node
// `transom sync`: send what this host's own inbox holds to the wall it is
// paired with, each file once.
//
//   transom sync            everything not sent to this wall yet
//   transom sync --zone Z   one zone
//   transom sync --dry      say what would go, send nothing
//
// For what landed here before `transom pair` pointed this host at another
// wall, and for anything written into the inbox without `transom post`. The
// local copy stays. A card's clock starts again on the other wall.
//
// What has gone is a marker per file under `synced/`, naming the wall it went
// to, so pairing with a different wall sends again. Each run drops the markers
// of files the inbox no longer holds.

import { existsSync, mkdirSync, openAsBlob, readFileSync, readdirSync, rmSync, statSync,
         writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir, hostname } from 'node:os'
import path from 'node:path'
import { PROTOCOL } from '../shared/remote.ts'
import { HELD_EXT } from '../server/kind.ts'

const fail = (text, code = 1) => {
  console.error(`transom sync: ${text}`)
  process.exit(code)
}

const argv = process.argv.slice(2)
let dry = false
let only = ''
while (argv.length > 0) {
  const flag = argv.shift()
  if (flag === '--dry' || flag === '--dry-run') dry = true
  else if (flag === '--zone' && argv.length > 0) only = argv.shift()
  else fail(`no such flag: ${flag}`)
}

const root = process.env.TRANSOM_ROOT ?? path.join(homedir(), 'transom')
const inbox = path.join(root, 'inbox')
const synced = path.join(root, 'synced')

const env = (() => {
  try {
    return Object.fromEntries(
      readFileSync(path.join(root, 'wall.env'), 'utf8').split('\n')
        .map((line) => /^([A-Z_]+)=(.*)$/.exec(line)).filter(Boolean).map((m) => [m[1], m[2]]),
    )
  } catch {
    return {}
  }
})()
const wall = env.TRANSOM_WALL
if (!wall || !env.TRANSOM_TOKEN)
  fail('this host sends to no other wall. Run `transom pair <this host>` on the wall\'s Mac.')

const dirs = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}
const json = (file) => {
  try {
    const blob = JSON.parse(readFileSync(file, 'utf8'))
    return blob && typeof blob === 'object' && !Array.isArray(blob) ? blob : {}
  } catch {
    return {}
  }
}

const marker = (zone, name) => path.join(synced, zone, name)
const sentTo = (zone, name) => {
  try {
    return readFileSync(marker(zone, name), 'utf8').split('\t')[0]
  } catch {
    return ''
  }
}

// The zone's rule on the wall's side, which refuses the rest with a 400.
const ZONE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/
/** `.ttl30m.png` or `.png`: what the wall puts after the name it makes up. */
const suffixOf = (name) => {
  const ext = path.extname(name).toLowerCase()
  const ttl = /(\.ttl[A-Za-z0-9:-]+)\.[^.]+$/.exec(name)?.[1] ?? ''
  return `${ttl}${ext}`
}
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

const work = []
const skipped = []
for (const zone of dirs(inbox)) {
  if (only && zone !== only) continue
  if (!ZONE.test(zone) || zone.includes('..')) {
    skipped.push(`${zone}/: a remote wall takes a zone of letters, digits, '.', '_' and '-'`)
    continue
  }
  for (const name of readdirSync(path.join(inbox, zone))) {
    if (name.startsWith('.') || name.endsWith('.transom.json')) continue
    if (!HELD_EXT.includes(path.extname(name).toLowerCase())) continue
    const file = path.join(inbox, zone, name)
    const at = statSync(file, { throwIfNoEntry: false })
    if (!at?.isFile() || sentTo(zone, name) === wall) continue
    work.push({ zone, name, file, mtime: at.mtimeMs })
  }
}
// Oldest first, so the other wall piles them in the order they were made.
work.sort((a, b) => a.mtime - b.mtime)

// Markers for files the inbox has let go of, which nothing else would remove.
if (!dry) {
  for (const zone of dirs(synced)) {
    for (const name of readdirSync(path.join(synced, zone)))
      if (!existsSync(path.join(inbox, zone, name))) rmSync(marker(zone, name), { force: true })
    if (readdirSync(path.join(synced, zone)).length === 0) rmSync(path.join(synced, zone), { recursive: true })
  }
}

for (const line of skipped) console.error(`transom sync: skipped ${line}`)
if (work.length === 0) {
  console.log(`nothing to send to ${wall}`)
  process.exit(0)
}

const host = (() => {
  try {
    return execFileSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return hostname().split('.')[0]
  }
})()

/** The sidecar the file already has, plus what a remote send adds to one. */
function sidecarFor({ zone, name, file }) {
  const side = json(`${file}.transom.json`)
  const stem = name.slice(0, name.length - suffixOf(name).length)
  // A file written here by hand has only its name to say what it is.
  if (typeof side.caption !== 'string' && !UUID.test(stem)) side.caption = stem
  side.host = host
  const zoneRoot = json(path.join(root, 'zones', `${zone}.json`)).root
  if (typeof zoneRoot === 'string' && zoneRoot !== '') {
    side.zoneRoot = zoneRoot
    try {
      side.hued = readFileSync(path.join(zoneRoot, '.hued'), 'utf8')
    } catch {
      // No colors of its own, which is most projects.
    }
  }
  return Buffer.from(JSON.stringify(side)).toString('base64')
}

const width = String(work.length).length
let failed = 0
for (const [i, item] of work.entries()) {
  const at = `${String(i + 1).padStart(width)}/${work.length}  ${item.zone}/${item.name}`
  if (dry) {
    console.log(at)
    continue
  }
  let res
  try {
    res = await fetch(`${wall}/api/inbox/${item.zone}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.TRANSOM_TOKEN}`,
        'X-Transom-Protocol': String(PROTOCOL),
        'X-Transom-Name': suffixOf(item.name),
        'X-Transom-Sidecar': sidecarFor(item),
      },
      body: await openAsBlob(item.file),
    })
  } catch {
    // What is left would fail the same way, and a rerun sends only that.
    fail(`the wall at ${wall} is not answering, with ${work.length - i} left to send`, 6)
  }
  if (!res.ok) {
    failed++
    console.error(`${at}  refused (HTTP ${res.status}): ${(await res.text()).trim()}`)
    continue
  }
  const { path: landed } = await res.json()
  mkdirSync(path.join(synced, item.zone), { recursive: true })
  writeFileSync(marker(item.zone, item.name), `${wall}\t${landed}\n`)
  console.log(at)
}
if (dry) console.log(`would send ${work.length} to ${wall}`)
else console.log(`sent ${work.length - failed} to ${wall}${failed ? `, ${failed} refused` : ''}`)
process.exit(failed ? 1 : 0)
