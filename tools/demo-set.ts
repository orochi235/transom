/**
 * Builds the picture set the public demo wall plays, out of the real inbox.
 *
 *   npm run demo:stage   copies candidates to demo/staging/ for pruning
 *   npm run demo:pack    turns what survives into demo/img/ + demo/manifest.json
 *
 * Two steps because the middle one is a person: the wall carries whatever an
 * agent made that day, and the half of it worth showing a stranger is not a
 * rule. Delete from demo/staging/ and run pack.
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { homedir } from 'node:os'
import sharp, { type Metadata } from 'sharp'
import { captionFor } from '../server/captionName.ts'
import type { Stamp } from '../server/xmp.ts'

/**
 * The zones a render may go public from. An allowlist, never a denylist: this
 * wall carries work zones too, and a zone nobody has thought about yet must
 * fail closed. Adding a name here is a decision to publish that repo's output.
 */
const ZONES = ['transom', 'brick-icons', 'weasel', 'windease', 'levar', 'onto'] as const

/** What a stranger's browser downloads per card, the wall's own cap. */
const MAX_EDGE = 1024
/** The lightbox's copy, fetched only when a card is opened. Past this a
 *  retina screenshot gains nothing a reader can see. */
const FULL_EDGE = 4096

const INBOX = join(homedir(), 'transom', 'inbox')
const STAGING = 'demo/staging'
const OUT = 'demo/img'
const MANIFEST = 'demo/manifest.json'

/** The whole set, as the demo daemon reads it back. */
export type DemoSet = {
  items: DemoItem[]
  /** Zone to the color the real daemon read off that project's `.hued`.
   *  Baked rather than hand-picked, so the demo wall is tinted the way this
   *  one is. */
  zones: Record<string, string>
}

/** One picture in the set, as the demo daemon reads it back. */
export type DemoItem = {
  zone: string
  /** Path under `demo/`, which is also what the built site serves. */
  file: string
  /** The same picture at full size, for the lightbox. Absent where `file`
   *  already is full size. */
  full?: string
  /** The caption the real wall would have shown. */
  name: string
  /** The source's own pixels, not the resized file's — what the lightbox
   *  reports and what a card's aspect comes from. */
  w: number
  h: number
  /** When it really landed, epoch ms. The daemon scales these into a window;
   *  keeping the true instant here leaves that policy in one place. */
  bornAt: number
  repo?: string
  sha?: string
}

const PICTURES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

/** The color the daemon would have given this zone: the `background` line of
 *  the project's `.hued`, found through the zone's own registration file. */
const colorOf = async (zone: string): Promise<string | null> => {
  try {
    const reg = JSON.parse(
      await readFile(join(homedir(), 'transom', 'zones', `${zone}.json`), 'utf8'),
    ) as { root?: string }
    if (!reg.root) return null
    const hued = await readFile(join(reg.root, '.hued'), 'utf8')
    return /^background=(\S+)/m.exec(hued)?.[1] ?? null
  } catch {
    return null
  }
}

const sidecarOf = async (path: string): Promise<Stamp | null> => {
  try {
    return JSON.parse(await readFile(`${path}.transom.json`, 'utf8')) as Stamp
  } catch {
    return null
  }
}

async function stage() {
  await rm(STAGING, { recursive: true, force: true })
  await mkdir(STAGING, { recursive: true })
  let staged = 0
  for (const zone of ZONES) {
    const dir = join(INBOX, zone)
    const names = await readdir(dir).catch(() => [])
    const pictures = names.filter((n) => PICTURES.has(extname(n).toLowerCase()))
    for (const name of pictures) {
      // Named for the eye doing the pruning: zone first, so one repo's output
      // sorts together in whatever is being used to look through them.
      const out = join(STAGING, `${zone}__${name}`)
      await sharp(join(dir, name)).toFile(out).catch(() => {})
      const side = await readFile(join(dir, `${name}.transom.json`), 'utf8').catch(() => null)
      if (side) await writeFile(`${out}.transom.json`, side)
      staged += 1
      console.log(`${String(staged).padStart(4)}  ${zone}/${name}`)
    }
    if (pictures.length === 0) console.log(`   0  ${zone}  (nothing in the inbox)`)
  }
  console.log(`\n${staged} staged in ${STAGING}/. Delete what should not go public, then npm run demo:pack.`)
}

/** Writes the lightbox's full-size copy beside a card's file, where the card
 *  had to be shrunk. Returns its path under `demo/`. */
async function packFull(src: string, file: string, meta: Metadata): Promise<string | undefined> {
  if (Math.max(meta.width ?? 0, meta.height ?? 0) <= MAX_EDGE) return undefined
  const full = file.replace(/\.webp$/, '.full.webp')
  await sharp(src)
    .rotate()
    .resize({ width: FULL_EDGE, height: FULL_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(join('demo', full))
  return full
}

async function pack() {
  const names = (await readdir(STAGING).catch(() => [])).filter((n) =>
    PICTURES.has(extname(n).toLowerCase()),
  )
  if (names.length === 0) {
    console.error(`nothing in ${STAGING}/ — run npm run demo:stage first`)
    process.exitCode = 1
    return
  }
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  const items: DemoItem[] = []
  let bytes = 0
  for (const [i, name] of names.entries()) {
    const src = join(STAGING, name)
    const zone = name.slice(0, name.indexOf('__'))
    // A zone that is not on the list cannot arrive here by a stale staging
    // directory: the check is at both ends, because only this one is committed.
    if (!(ZONES as readonly string[]).includes(zone)) {
      console.log(`${String(i + 1).padStart(4)}/${names.length}  skipped ${name} — ${zone} is not allowed out`)
      continue
    }
    const meta = await sharp(src).metadata()
    const file = `img/${String(items.length).padStart(3, '0')}.webp`
    const info = await sharp(src)
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(join('demo', file))
    bytes += info.size
    const full = await packFull(src, file, meta)
    const original = basename(name.slice(zone.length + 2))
    const side = await sidecarOf(src)
    items.push({
      zone,
      file,
      name: captionFor(original, side),
      w: meta.width ?? info.width,
      h: meta.height ?? info.height,
      ...(full ? { full } : {}),
      bornAt: (await stat(src)).mtimeMs,
      ...(side?.repo ? { repo: side.repo } : {}),
      ...(side?.sha ? { sha: side.sha } : {}),
    })
    console.log(
      `${String(i + 1).padStart(4)}/${names.length}  ${file}  ${info.width}×${info.height}  ${(info.size / 1024).toFixed(0)}k  ${zone}${full ? '  + full' : ''}`,
    )
  }

  items.sort((a, b) => a.bornAt - b.bornAt)
  const zones: Record<string, string> = {}
  for (const zone of new Set(items.map((i) => i.zone))) {
    const color = await colorOf(zone)
    if (color) zones[zone] = color
  }
  const set: DemoSet = { items, zones }
  await writeFile(MANIFEST, JSON.stringify(set, null, 2) + '\n')
  const perZone = new Map<string, number>()
  for (const item of items) perZone.set(item.zone, (perZone.get(item.zone) ?? 0) + 1)
  console.log(`\n${items.length} pictures, ${(bytes / 1024 / 1024).toFixed(1)} MB, into ${MANIFEST}`)
  for (const [zone, n] of [...perZone].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${zone}  ${zones[zone] ?? '(no .hued)'}`)
  }
}

const step = process.argv[2]
if (step === 'stage') await stage()
else if (step === 'pack') await pack()
else {
  console.error('usage: demo-set.ts stage | pack')
  process.exitCode = 1
}
