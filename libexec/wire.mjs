#!/usr/bin/env node
// `transom wire`: put transom in front of the agents on this machine.
//
//   transom wire            install into every Claude config dir found
//   transom wire --off      take it back out
//   transom wire --dry      say what would change, change nothing
//   transom wire --repo     enroll the repo you are in: write its .transom.yaml,
//                           or check the one it has. With --off, remove a
//                           starter file nobody has edited.
//
// Three mechanical pieces: the skill on the skills path, the wall-nudge hook in
// settings.json, and `transom` on PATH. The CLAUDE.md rule is prose and is only
// checked here — a tool that rewrites hand-written preferences fights its author.
//
// Idempotent: re-running strips every transom-tagged hook entry and re-adds it.

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync,
         rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'

const MARKER = 'transom'
// node resolves the entry script's symlinks, so under Homebrew this file sees the
// versioned Cellar path; the formula points TRANSOM_HOME at the stable opt path.
const REPO = process.env.TRANSOM_HOME
  ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const HOME = homedir()

const args = new Set(process.argv.slice(2))
const off = args.has('--off') || args.has('--uninstall')
const dry = args.has('--dry') || args.has('--dry-run')

const say = (mark, text) => console.log(`${mark} ${text}`)
const rel = (p) => p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p

/** Every Claude Code config directory on this machine. */
function configDirs() {
  return readdirSync(HOME, { withFileTypes: true })
    .filter((e) => e.isDirectory() && (e.name === '.claude' || e.name.startsWith('.claude-')))
    .map((e) => path.join(HOME, e.name))
    .filter((d) => existsSync(path.join(d, 'settings.json')) || existsSync(path.join(d, 'skills')))
    .sort()
}

function linkSkill(dir) {
  const dest = path.join(dir, 'skills', MARKER)
  const src = path.join(REPO, 'skills', MARKER)
  const already = existsSync(dest) && lstatSync(dest).isSymbolicLink() && readlinkSync(dest) === src
  if (off) {
    if (!already) return `skill absent`
    if (!dry) rmSync(dest)
    return `skill unlinked`
  }
  if (already) return `skill already linked`
  if (existsSync(dest) || lstatSync(dest, { throwIfNoEntry: false })) {
    return `skill NOT linked — ${rel(dest)} exists and is not our symlink`
  }
  if (!dry) {
    mkdirSync(path.dirname(dest), { recursive: true })
    symlinkSync(src, dest)
  }
  return `skill linked`
}

/** The hook entry, shaped the way Claude Code reads it and tagged so we own it. */
function hookEntry() {
  return {
    [MARKER]: 'wall-nudge',
    matcher: 'Read|Write|Bash',
    hooks: [{ type: 'command', command: `node "${path.join(REPO, 'hooks', 'wall-nudge.mjs')}"` }],
  }
}

function wireHook(dir) {
  const file = path.join(dir, 'settings.json')
  let settings = {}
  if (existsSync(file)) {
    try { settings = JSON.parse(readFileSync(file, 'utf8')) } catch {
      return `hook NOT wired — ${rel(file)} is not valid JSON`
    }
  }
  const hooks = settings.hooks ?? {}
  const before = hooks.PostToolUse ?? []
  const kept = before.filter((e) => e?.[MARKER] === undefined)
  const next = off ? kept : [...kept, hookEntry()]

  const removed = before.length - kept.length
  if (off && removed === 0) return `hook absent`
  if (JSON.stringify(before) === JSON.stringify(next)) return `hook already wired`
  if (!dry) {
    settings.hooks = { ...hooks, PostToolUse: next }
    writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`)
  }
  if (off) return `hook removed`
  return removed ? `hook rewired` : `hook wired`
}

/** `transom` typed bare has to resolve, or a half-remembered rule dies at not-found. */
function linkBin() {
  const target = path.join(REPO, 'bin', 'transom')
  const onPath = (process.env.PATH ?? '').split(':')
  const dest = [path.join(HOME, '.local', 'bin'), '/usr/local/bin']
    .find((d) => onPath.includes(d))
  if (!dest) return `transom NOT on PATH — no writable PATH directory found; add ${rel(path.join(REPO, 'bin'))} yourself`
  const link = path.join(dest, 'transom')
  const already = existsSync(link) && lstatSync(link).isSymbolicLink() && readlinkSync(link) === target
  if (off) {
    if (!already) return `transom link absent`
    if (!dry) rmSync(link)
    return `transom unlinked from ${rel(dest)}`
  }
  if (already) return `transom already on PATH at ${rel(link)}`
  if (existsSync(link)) return `transom NOT linked — ${rel(link)} exists and is not our symlink`
  if (!dry) {
    mkdirSync(dest, { recursive: true })
    symlinkSync(target, link)
  }
  return `transom linked at ${rel(link)}`
}

/** The rule itself lives in prose we do not own. Report, do not write.
 *  One hit is enough: ~/.claude/CLAUDE.md loads alongside each harness's own. */
function ruleFound(dirs) {
  return dirs.some((dir) => {
    const file = path.join(dir, 'CLAUDE.md')
    return existsSync(file) && /\btransom\b/.test(readFileSync(file, 'utf8'))
  })
}

async function daemon() {
  try {
    const res = await fetch('http://localhost:8787/api/health', { signal: AbortSignal.timeout(2000) })
    const body = await res.json()
    return `daemon up — ${body.items} on the wall, ttl ${Math.round(body.ttlMs / 3600000)}h`
  } catch {
    return `daemon down — renders still land in ~/transom/inbox and appear at its next start`
  }
}

/** The repo's settings file: written from the starter when absent, checked
 *  when present. Loaded only here, so wiring a machine needs no YAML at all. */
async function enrollRepo() {
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' })
  if (top.status !== 0) {
    console.error('transom wire --repo: not in a git repository')
    process.exit(1)
  }
  const { SETTINGS_FILE, STARTER, parseRepoSettings } = await import('../shared/repoSettings.ts')
  const file = path.join(top.stdout.trim(), SETTINGS_FILE)
  const have = existsSync(file) ? readFileSync(file, 'utf8') : null

  if (off) {
    if (have === null) return say('·', `${rel(file)} absent`)
    if (have !== STARTER) return say('!', `${rel(file)} has been edited — delete it yourself if you mean to`)
    if (!dry) rmSync(file)
    return say('·', `${rel(file)} removed`)
  }
  if (have === null) {
    if (!dry) writeFileSync(file, STARTER)
    say('·', `${rel(file)} written — every setting is commented out, so nothing changes until you uncomment one`)
    return say('·', 'commit it: the settings belong to the repo')
  }
  const { errors } = parseRepoSettings(have)
  if (errors.length === 0) return say('·', `${rel(file)} is valid`)
  for (const e of errors) say('!', `${rel(file)}: ${e}`)
  process.exit(1)
}

if (args.has('--repo')) {
  await enrollRepo()
  process.exit(0)
}

const dirs = configDirs()
if (dirs.length === 0) {
  console.error('transom wire: no Claude config directory found under ~. Nothing to wire.')
  process.exit(1)
}

say('·', `${off ? 'unwiring' : 'wiring'} transom from ${rel(REPO)}${dry ? ' (dry run)' : ''}`)
dirs.forEach((dir, i) => {
  say(`${i + 1}/${dirs.length}`, `${rel(dir)}: ${linkSkill(dir)}; ${wireHook(dir)}`)
})
say('·', linkBin())

if (!off && !ruleFound(dirs)) {
  say('!', `no transom rule in any CLAUDE.md — the hook only fires after a miss`)
  console.log(`
  Add this bullet to ~/.claude/CLAUDE.md, so an agent knows the wall exists
  before it renders anything:

  - **Any image you create goes on the wall, not just into a file.** Reading an
    image only shows it to you. Send it with \`transom post <file>\`, or pipe a generator
    straight in; the zone is the repo's own directory name. It prints a \`wall:\` link
    to the card; give that link when you mention the image. Never \`open\` a render in Preview.
`)
}
console.log(`· ${await daemon()}`)
if (!off) say('·', 'running sessions keep their hook snapshot — new sessions pick this up')
