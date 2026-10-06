# Remote senders and the reaper: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound everything the wall keeps on disk, then let fleet Macs send to a
wall on another Mac over HTTP, installed with `transom pair <host>`.

**Architecture:** A reaper module in the daemon prunes `trash/`, `.cache`,
`answers/`, `marks/`, `.incoming/` and the LaunchAgent logs, and evicts the
oldest unpinned cards when the wall exceeds its cap. Remote sending adds a
token-guarded router (`server/remote.ts`) that writes uploads into the
daemon's own inbox, so ingest does not change. On the sender, `bin/transom`
switches to `curl` when `~/transom/wall.env` exists. `transom pair` runs on
the wall host and sets up a node over ssh.

**Tech stack:** Node + Express 5 + TypeScript run by `tsx`, vitest, POSIX `sh`
for the CLI, React for the band chip.

**Spec:** `docs/superpowers/specs/2026-10-05-remote-senders-design.md`

## Global constraints

- Caps: trash TTL 24h and **10 GB**; wall (inbox + `.cache`) **20 GB**; logs **25 MB**, one `.1` kept; uploads **2 GB**; reap every **10 minutes** and at startup.
- Variables: `TRANSOM_TRASH_TTL`, `TRANSOM_TRASH_MAX`, `TRANSOM_WALL_MAX`, `TRANSOM_LOG_MAX`. Sizes accept `10G`, `500M`, `25M` or plain bytes.
- Age is `max(mtimeMs, ctimeMs)`. Measured on APFS: `rename` updates ctime and keeps mtime, and expiry renames files into the trash.
- Eviction never takes a pinned card (`keptAt`), an open question, a card holding pending marks, or a card in an `eternal` zone. It is never an undo step.
- Protocol version is `1`, in `shared/remote.ts` and as `TRANSOM_PROTOCOL=1` in `bin/transom`; a test holds them equal.
- Loopback (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) is exempt from the token. Everything else needs `Authorization: Bearer <token>` on the remote routes and the marks routes.
- Remote mode is on exactly when `$TRANSOM_ROOT/wall.env` exists (default `~/transom/wall.env`).
- Wall unreachable within 3s: exit 6, `transom <verb>: the wall at <url> is not answering`.
- US English; no file grows past a few hundred lines. `server/index.ts` (475 lines) gets routes only through mount functions, never new handlers inline.
- No new npm dependencies.

## Review focus

- **An upload cut off partway** (network drop, killed `curl`) must leave nothing in a zone. It stays in `.incoming/` and the reaper deletes it after an hour. Test in Task 6.
- **A zone name or file suffix carrying `..` or `/`** in a remote request must be refused with 400 and must never escape the inbox. Test in Task 6.
- **The wall host asleep during `ask`**: the long poll must keep retrying until the wall answers, not exit on the first connection failure. Exit 6 applies only to the initial send. Test in Task 8.
- **A token file deleted while the daemon runs**: the daemon keeps the token it loaded until restart, so nodes keep working. Test in Task 6.
- **The daemon restarting with a full wall**: until the inbox has been re-adopted the store is empty, so every thumbnail and marks record looks orphaned. The first pass waits for `ready`, and orphan thumbnails must also be an hour old. Test in Task 3.
- **The trash holding one entry bigger than the whole cap**: the reaper deletes it and does not loop. Test in Task 1.

---

## Piece 1: the reaper

### Task 1: Reaper primitives

**Files:**
- Create: `server/bytes.ts`, `server/bytes.test.ts`
- Create: `server/reaper.ts`, `server/reaper.test.ts`

**Interfaces:**
- Produces: `parseBytes(text: string | undefined, fallback: number): number`
- Produces: `touchedAt(st: Stats): number`, `bytesOf(path): Promise<number>`, `pruneByAge(dir, maxAgeMs, now, keep?: (name: string) => boolean): Promise<number>`, `pruneToSize(dir, maxBytes): Promise<number>`, `rotateLog(file, maxBytes): Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

`server/bytes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseBytes } from './bytes.ts'

describe('parseBytes', () => {
  it('reads the units a person writes', () => {
    expect(parseBytes('10G', 0)).toBe(10 * 1024 ** 3)
    expect(parseBytes('500M', 0)).toBe(500 * 1024 ** 2)
    expect(parseBytes('64k', 0)).toBe(64 * 1024)
    expect(parseBytes('1234', 0)).toBe(1234)
  })
  it('falls back on anything it cannot read', () => {
    expect(parseBytes(undefined, 7)).toBe(7)
    expect(parseBytes('lots', 7)).toBe(7)
    expect(parseBytes('-5G', 7)).toBe(7)
  })
})
```

`server/reaper.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bytesOf, pruneByAge, pruneToSize, rotateLog } from './reaper.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'transom-reaper-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A file of `size` bytes whose mtime is `ageMs` before `now`. Its ctime is
 *  the real now, so tests pass `now` near Date.now() for ctime to count. */
async function file(name: string, size: number, mtime: number) {
  const p = join(dir, name)
  await writeFile(p, Buffer.alloc(size))
  await utimes(p, mtime / 1000, mtime / 1000)
  return p
}

describe('pruneByAge', () => {
  it('deletes what was last touched before the cutoff, and keeps the rest', async () => {
    const now = Date.now()
    await file('old', 1, now - 3 * 3_600_000)
    await file('new', 1, now)
    // ctime is now for both, so age by touch keeps both until the clock moves.
    expect(await pruneByAge(dir, 3_600_000, now)).toBe(0)
    expect(await pruneByAge(dir, 3_600_000, now + 2 * 3_600_000)).toBe(2)
    expect(readdirSync(dir)).toEqual([])
  })
  it('passes over what `keep` names', async () => {
    const now = Date.now()
    await file('a', 1, now)
    await mkdir(join(dir, 'waiting'))
    expect(await pruneByAge(dir, 1, now + 10_000, (n) => n === 'waiting')).toBe(1)
    expect(readdirSync(dir)).toEqual(['waiting'])
  })
  it('is nothing for a directory that does not exist', async () => {
    expect(await pruneByAge(join(dir, 'nope'), 1, Date.now())).toBe(0)
  })
})

describe('pruneToSize', () => {
  it('deletes oldest first until under the cap', async () => {
    const now = Date.now()
    await file('a', 100, now - 3000)
    await file('b', 100, now - 2000)
    await file('c', 100, now - 1000)
    // utimes bumps ctime to now, so each file's age is when it was written:
    // a, then b, then c.
    expect(await pruneToSize(dir, 150)).toBe(2)
    expect(readdirSync(dir)).toEqual(['c'])
  })
  it('deletes one entry bigger than the whole cap and stops', async () => {
    await file('huge', 500, Date.now())
    expect(await pruneToSize(dir, 100)).toBe(1)
    expect(readdirSync(dir)).toEqual([])
  })
  it('counts a directory by everything inside it', async () => {
    await mkdir(join(dir, 'd'))
    await writeFile(join(dir, 'd', 'x'), Buffer.alloc(300))
    expect(await bytesOf(join(dir, 'd'))).toBe(300)
    expect(await pruneToSize(dir, 100)).toBe(1)
  })
})

describe('rotateLog', () => {
  it('copies to .1 and truncates in place once over the cap', async () => {
    const log = join(dir, 'daemon.log')
    await writeFile(log, 'x'.repeat(200))
    expect(await rotateLog(log, 100)).toBe(true)
    expect((await readFile(`${log}.1`, 'utf8')).length).toBe(200)
    expect((await readFile(log, 'utf8')).length).toBe(0)
  })
  it('leaves a log under the cap, and a missing one, alone', async () => {
    const log = join(dir, 'daemon.log')
    await writeFile(log, 'x')
    expect(await rotateLog(log, 100)).toBe(false)
    expect(await rotateLog(join(dir, 'none.log'), 100)).toBe(false)
    expect(existsSync(`${log}.1`)).toBe(false)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run server/bytes.test.ts server/reaper.test.ts`
Expected: FAIL, cannot resolve `./bytes.ts` / `./reaper.ts`.

- [ ] **Step 3: Implement**

`server/bytes.ts`:

```ts
const UNITS: Record<string, number> = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }

/** A size as a person writes it — `10G`, `500M`, `64k`, or bytes. */
export function parseBytes(text: string | undefined, fallback: number): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kmg]?)b?\s*$/i.exec(text ?? '')
  if (!m) return fallback
  return Math.round(Number(m[1]) * UNITS[m[2]!.toLowerCase()]!)
}
```

`server/reaper.ts`:

```ts
import { copyFile, lstat, readdir, rm, truncate } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { join } from 'node:path'

/** When a file was last written or moved. A rename into the trash keeps the
 *  mtime and bumps the ctime (measured on APFS), so mtime alone would age a
 *  card by when it was rendered rather than when it was thrown away. */
export const touchedAt = (st: Stats) => Math.max(st.mtimeMs, st.ctimeMs)

export async function bytesOf(path: string): Promise<number> {
  const st = await lstat(path).catch(() => null)
  if (!st) return 0
  if (!st.isDirectory()) return st.size
  const names = await readdir(path).catch(() => [] as string[])
  let total = 0
  for (const n of names) total += await bytesOf(join(path, n))
  return total
}

type Held = { path: string; at: number; mtime: number; bytes: number }

async function entries(dir: string, keep?: (name: string) => boolean): Promise<Held[]> {
  const names = await readdir(dir).catch(() => [] as string[])
  const out: Held[] = []
  for (const name of names) {
    if (keep?.(name)) continue
    const path = join(dir, name)
    const st = await lstat(path).catch(() => null)
    if (!st) continue
    out.push({ path, at: touchedAt(st), mtime: st.mtimeMs, bytes: await bytesOf(path) })
  }
  return out
}

/** Deletes each top-level entry last touched before `now - maxAgeMs`. */
export async function pruneByAge(
  dir: string,
  maxAgeMs: number,
  now: number,
  keep?: (name: string) => boolean,
): Promise<number> {
  let gone = 0
  for (const e of await entries(dir, keep)) {
    if (e.at >= now - maxAgeMs) continue
    await rm(e.path, { recursive: true, force: true })
    gone++
  }
  return gone
}

/** Deletes the oldest top-level entries until the directory fits `maxBytes`. */
export async function pruneToSize(dir: string, maxBytes: number): Promise<number> {
  const all = await entries(dir)
  all.sort((a, b) => a.at - b.at || a.mtime - b.mtime)
  let total = all.reduce((sum, e) => sum + e.bytes, 0)
  let gone = 0
  for (const e of all) {
    if (total <= maxBytes) break
    await rm(e.path, { recursive: true, force: true })
    total -= e.bytes
    gone++
  }
  return gone
}

/** Copy-and-truncate, which is safe only because launchd opens the log with
 *  O_APPEND: a writer without it keeps its offset and leaves a sparse file. */
export async function rotateLog(file: string, maxBytes: number): Promise<boolean> {
  const st = await lstat(file).catch(() => null)
  if (!st || st.size <= maxBytes) return false
  await copyFile(file, `${file}.1`)
  await truncate(file, 0)
  return true
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run server/bytes.test.ts server/reaper.test.ts`
Expected: PASS. If the `pruneToSize` ordering test is flaky because ctimes differ by a few ms, the sort on `at` already orders them by write time, which is the same order; leave the test as is.

- [ ] **Step 5: Commit**

```bash
git add server/bytes.ts server/bytes.test.ts server/reaper.ts server/reaper.test.ts
git commit -m "add reaper primitives that prune a directory by age and by size"
```

### Task 2: What the store lets the reaper take

**Files:**
- Modify: `server/store.ts` (add three exports after `snapshot()`, around line 125)
- Create: `server/evict.test.ts`

**Interfaces:**
- Consumes: `isOpen`, `holdsMarks`, `filesOf`, `artifactsOf`, `expire`, `entries` (module-private in `store.ts`); `isEternal`, `zoneLifetime` (already imported there).
- Produces:
  - `evictable(): { id: string; bornAt: number; paths: string[] }[]`, oldest `bornAt` first.
  - `inUse(): { ids: Set<string>; caches: Set<string> }`
  - `evict(id: string): Promise<boolean>`, expiry that fires the `onExpire` listeners and is never an undo step.

- [ ] **Step 1: Write the failing test** (`server/evict.test.ts`, using the `freshStore` pattern from `store.test.ts`)

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WallItem } from '@shared/protocol.ts'

async function freshStore(root: string) {
  process.env.TRANSOM_ROOT = root
  vi.resetModules()
  return await import('./store.ts')
}

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'transom-evict-'))
  await mkdir(join(root, 'inbox', 'z'), { recursive: true })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function card(store: Awaited<ReturnType<typeof freshStore>>, id: string, over: Partial<WallItem> = {}) {
  const sourcePath = join(root, 'inbox', 'z', `${id}.png`)
  await writeFile(sourcePath, 'png')
  const item = { id, url: '', origUrl: '', zone: 'z', name: id, path: sourcePath, bornAt: 1000, w: 1, h: 1, ...over } as WallItem
  store.add({ item, sourcePath, cachePath: join(root, '.cache', `${id}.webp`) })
}

describe('evictable', () => {
  it('lists unpinned cards oldest first, with every file they hold', async () => {
    const store = await freshStore(root)
    await card(store, 'young', { bornAt: 2000 })
    await card(store, 'old', { bornAt: 1000 })
    await card(store, 'pinned', { bornAt: 500, keptAt: 600 })
    const list = store.evictable()
    expect(list.map((c) => c.id)).toEqual(['old', 'young'])
    expect(list[0]!.paths).toEqual([join(root, 'inbox', 'z', 'old.png'), join(root, '.cache', 'old.webp')])
  })
  it('passes over an open question', async () => {
    const store = await freshStore(root)
    await card(store, 'q', { question: 'which?' })
    expect(store.evictable()).toEqual([])
  })
})

describe('evict', () => {
  it('moves the card to the trash, tells listeners, and leaves no undo', async () => {
    const store = await freshStore(root)
    await card(store, 'a')
    const heard: string[] = []
    store.onExpire((id) => heard.push(id))
    expect(await store.evict('a')).toBe(true)
    expect(heard).toEqual(['a'])
    expect(existsSync(join(root, 'inbox', 'z', 'a.png'))).toBe(false)
    expect(existsSync(join(root, 'trash', 'a-z'))).toBe(true)
    expect(await store.undo()).toEqual([])
  })
})

describe('inUse', () => {
  it('names every artifact id and cache file on the wall', async () => {
    const store = await freshStore(root)
    await card(store, 'a')
    const { ids, caches } = store.inUse()
    expect([...ids]).toEqual(['a'])
    expect([...caches]).toEqual([join(root, '.cache', 'a.webp')])
  })
})
```

Before writing the undo assertion, check what `store.undo` returns with an empty stack (`grep -n "export async function undo" -A10 server/store.ts`) and match that value.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run server/evict.test.ts`
Expected: FAIL, `store.evictable is not a function`.

- [ ] **Step 3: Implement** (in `server/store.ts`, after `snapshot()`)

```ts
/** What the reaper may take when the wall is over its cap, oldest first. A
 *  pinned card, an open question, undelivered marks and an eternal zone are
 *  never on it. */
export function evictable(): { id: string; bornAt: number; paths: string[] }[] {
  return [...entries.values()]
    .filter((e) => !e.item.keptAt && !isOpen(e.item) && !holdsMarks(e) && !isEternal(zoneLifetime(e.item.zone)))
    .sort((a, b) => a.item.bornAt - b.item.bornAt)
    .map((e) => ({
      id: e.item.id,
      bornAt: e.item.bornAt,
      paths: filesOf(e).flatMap((f) => [f.sourcePath, f.cachePath]),
    }))
}

/** Every artifact id and thumbnail a card on the wall still uses. */
export function inUse(): { ids: Set<string>; caches: Set<string> } {
  const ids = new Set<string>()
  const caches = new Set<string>()
  for (const e of entries.values()) {
    for (const [id, f] of artifactsOf(e)) {
      ids.add(id)
      caches.add(f.cachePath)
    }
  }
  return { ids, caches }
}

/** Expiry for space. Announced like a TTL running out, so never an undo step. */
export async function evict(id: string): Promise<boolean> {
  const entry = entries.get(id)
  if (!entry) return false
  await expire(entry)
  return true
}
```

`isOpen` is declared further down the file as a `const` arrow function (line 338). Calls to it run later, so the order of declarations does not matter, but run `npx tsc --noEmit` to confirm.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run server/evict.test.ts server/store.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add server/store.ts server/evict.test.ts
git commit -m "let the store say which cards the wall may evict for space"
```

### Task 3: The reap pass, wired into the daemon

**Files:**
- Modify: `server/config.ts`
- Create: `server/reap.ts`, `server/reap.test.ts`
- Create: `server/disk.ts` (the mount and timer, keeping `index.ts` to one line of wiring)
- Modify: `server/index.ts` (one import, one call, `disk` in the snapshot)
- Modify: `shared/protocol.ts` (the `Disk` type, a `disk` message, `disk` in the snapshot)

**Interfaces:**
- Consumes: everything Task 1 and Task 2 produce.
- Produces:
  - `type Disk = { wallBytes: number; wallMax: number; trashBytes: number; over: boolean }`, in `shared/protocol.ts`
  - `reap(deps: ReapDeps, now?: number): Promise<Disk>`
  - `startReaper(ready: Promise<void>, onDisk: (d: Disk) => void): void`, in `server/disk.ts`
  - `watchInbox` returns `{ close, ready }`
  - `ServerMessage` gains `{ type: 'disk'; disk: Disk }`, and the snapshot gains `disk: Disk | null`

- [ ] **Step 1: Add the config** (`server/config.ts`, inside `config`, after `trashMs`, replacing the literal `trashMs`)

```ts
  trashMs: parseDuration(process.env.TRANSOM_TRASH_TTL ?? '24h') ?? 86_400_000,
  trashMaxBytes: parseBytes(process.env.TRANSOM_TRASH_MAX, 10 * 1024 ** 3),
  /** The inbox and the thumbnail cache together: what the wall is holding. */
  wallMaxBytes: parseBytes(process.env.TRANSOM_WALL_MAX, 20 * 1024 ** 3),
  logMaxBytes: parseBytes(process.env.TRANSOM_LOG_MAX, 25 * 1024 ** 2),
  uploadMaxBytes: 2 * 1024 ** 3,
  /** An answer nobody collected, and a partial upload, are both abandoned by now. */
  answersMs: 86_400_000,
  incomingMs: 3_600_000,
  reapMs: 10 * 60_000,
  incoming: join(root, '.incoming'),
  logs: join(homedir(), '.local', 'state', 'transom'),
```

Add `import { parseBytes } from './bytes.ts'` at the top.

- [ ] **Step 2: Write the failing test** (`server/reap.test.ts`)

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reap, type ReapDeps } from './reap.ts'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'transom-reap-'))
  for (const d of ['inbox/z', '.cache', 'trash', 'answers', 'marks/waiting', '.incoming', 'logs'])
    await mkdir(join(root, d), { recursive: true })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const later = (h: number) => Date.now() + h * 3_600_000

function deps(over: Partial<ReapDeps> = {}): ReapDeps {
  return {
    dirs: {
      inbox: join(root, 'inbox'), cache: join(root, '.cache'), trash: join(root, 'trash'),
      answers: join(root, 'answers'), marks: join(root, 'marks'), incoming: join(root, '.incoming'),
      logs: join(root, 'logs'),
    },
    limits: { trashMs: 86_400_000, trashMaxBytes: 1000, wallMaxBytes: 1000, logMaxBytes: 100, answersMs: 86_400_000, incomingMs: 3_600_000 },
    inUse: () => ({ ids: new Set(), caches: new Set() }),
    evictable: () => [],
    evict: async () => true,
    ...over,
  }
}

describe('reap', () => {
  it('empties the trash, answers, partial uploads and orphan marks by age', async () => {
    await writeFile(join(root, 'trash', 'a-z'), 'x')
    await writeFile(join(root, 'answers', 'q.png'), 'answered\n')
    await writeFile(join(root, '.incoming', 'u1'), 'half')
    await writeFile(join(root, 'marks', 'gone.json'), '{}')
    await writeFile(join(root, 'marks', 'live.json'), '{}')
    await writeFile(join(root, 'marks', 'waiting', 's1'), '')
    await reap(deps({ inUse: () => ({ ids: new Set(['live']), caches: new Set() }) }), later(25))
    expect(existsSync(join(root, 'trash', 'a-z'))).toBe(false)
    expect(existsSync(join(root, 'answers', 'q.png'))).toBe(false)
    expect(existsSync(join(root, '.incoming', 'u1'))).toBe(false)
    expect(existsSync(join(root, 'marks', 'gone.json'))).toBe(false)
    expect(existsSync(join(root, 'marks', 'live.json'))).toBe(true)
    expect(existsSync(join(root, 'marks', 'waiting', 's1'))).toBe(true)
  })

  it('deletes thumbnails no card uses once they are an hour old', async () => {
    await writeFile(join(root, '.cache', 'keep.webp'), 'x')
    await writeFile(join(root, '.cache', 'orphan.webp'), 'x')
    const d = deps({ inUse: () => ({ ids: new Set(), caches: new Set([join(root, '.cache', 'keep.webp')]) }) })
    // Ingest writes the thumbnail before the store holds the card, so a fresh
    // orphan may be a card halfway in.
    await reap(d)
    expect(existsSync(join(root, '.cache', 'orphan.webp'))).toBe(true)
    await reap(d, later(2))
    expect(existsSync(join(root, '.cache', 'keep.webp'))).toBe(true)
    expect(existsSync(join(root, '.cache', 'orphan.webp'))).toBe(false)
  })

  it('evicts oldest first until the wall fits, and reports over when pins alone exceed it', async () => {
    const a = join(root, 'inbox', 'z', 'a.png')
    const b = join(root, 'inbox', 'z', 'b.png')
    const pinned = join(root, 'inbox', 'z', 'p.png')
    await writeFile(a, Buffer.alloc(600))
    await writeFile(b, Buffer.alloc(600))
    await writeFile(pinned, Buffer.alloc(200))
    const taken: string[] = []
    const d = deps({
      evictable: () => [{ id: 'a', bornAt: 1, paths: [a] }, { id: 'b', bornAt: 2, paths: [b] }],
      evict: async (id) => {
        taken.push(id)
        await rm(id === 'a' ? a : b)
        return true
      },
    })
    const disk = await reap(d)
    expect(taken).toEqual(['a'])
    expect(disk.over).toBe(false)
    expect(disk.wallBytes).toBe(800)

    const tight = await reap({ ...d, evictable: () => [], limits: { ...d.limits, wallMaxBytes: 100 } })
    expect(tight.over).toBe(true)
  })

  it('rotates every log over the cap', async () => {
    await writeFile(join(root, 'logs', 'daemon.log'), 'x'.repeat(200))
    await writeFile(join(root, 'logs', 'client.log'), 'x')
    await reap(deps())
    expect(existsSync(join(root, 'logs', 'daemon.log.1'))).toBe(true)
    expect(existsSync(join(root, 'logs', 'client.log.1'))).toBe(false)
  })
})
```

- [ ] **Step 3: Run to see it fail**

Run: `npx vitest run server/reap.test.ts`
Expected: FAIL, cannot resolve `./reap.ts`.

- [ ] **Step 4: Implement `server/reap.ts`**

```ts
import { lstat, readdir, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { Disk } from '@shared/protocol.ts'
import { bytesOf, pruneByAge, pruneToSize, rotateLog, touchedAt } from './reaper.ts'

export type ReapDeps = {
  dirs: { inbox: string; cache: string; trash: string; answers: string; marks: string; incoming: string; logs: string }
  limits: {
    trashMs: number; trashMaxBytes: number; wallMaxBytes: number
    logMaxBytes: number; answersMs: number; incomingMs: number
  }
  inUse: () => { ids: Set<string>; caches: Set<string> }
  evictable: () => { id: string; bornAt: number; paths: string[] }[]
  evict: (id: string) => Promise<boolean>
}

/** One pass over everything the wall writes. Order matters: eviction moves
 *  cards into the trash, so the trash is bounded after it. */
export async function reap(d: ReapDeps, now = Date.now()): Promise<Disk> {
  const { dirs, limits } = d

  const { ids, caches } = d.inUse()
  for (const name of await readdir(dirs.cache).catch(() => [] as string[])) {
    const path = join(dirs.cache, name)
    if (caches.has(path)) continue
    // Ingest writes the thumbnail before the store holds the card.
    const st = await lstat(path).catch(() => null)
    if (st && touchedAt(st) < now - limits.incomingMs) await rm(path, { recursive: true, force: true })
  }

  let wallBytes = (await bytesOf(dirs.inbox)) + (await bytesOf(dirs.cache))
  for (const card of d.evictable()) {
    if (wallBytes <= limits.wallMaxBytes) break
    let bytes = 0
    for (const p of card.paths) bytes += await bytesOf(p)
    if (await d.evict(card.id)) wallBytes -= bytes
  }

  await pruneByAge(dirs.trash, limits.trashMs, now)
  await pruneToSize(dirs.trash, limits.trashMaxBytes)
  await pruneByAge(dirs.answers, limits.answersMs, now)
  await pruneByAge(dirs.incoming, limits.incomingMs, now)
  // A record and its composite share the artifact id; `waiting/` is the hook's flags.
  await pruneByAge(dirs.marks, limits.trashMs, now, (name) =>
    name === 'waiting' || ids.has(basename(name, extname(name))),
  )

  for (const name of await readdir(dirs.logs).catch(() => [] as string[])) {
    if (name.endsWith('.log')) await rotateLog(join(dirs.logs, name), limits.logMaxBytes)
  }

  return {
    wallBytes,
    wallMax: limits.wallMaxBytes,
    trashBytes: await bytesOf(dirs.trash),
    over: wallBytes > limits.wallMaxBytes,
  }
}
```

- [ ] **Step 5: Add `Disk` to `shared/protocol.ts`**

Above `ServerMessage`:

```ts
/** What the wall holds on disk, from the reaper's last pass. `over` means the
 *  cards it may not evict alone exceed the cap. */
export type Disk = { wallBytes: number; wallMax: number; trashBytes: number; over: boolean }
```

In the snapshot variant, after `build: Build`:

```ts
      /** The reaper's last pass, or null before its first. */
      disk: Disk | null
```

As a new union member after `zoneColors`:

```ts
  | { type: 'disk'; disk: Disk }
```

- [ ] **Step 6: Create `server/disk.ts`**

```ts
import type { Disk } from '@shared/protocol.ts'
import { config } from './config.ts'
import { reap } from './reap.ts'
import * as store from './store.ts'

/** Reaps once the inbox has been adopted, then on a timer. Before `ready` the
 *  store holds nothing, and every thumbnail and marks record would look
 *  orphaned. A failed pass is logged and the next one tries again: a disk
 *  error must never take the daemon down. */
export function startReaper(ready: Promise<void>, onDisk: (d: Disk) => void): void {
  const pass = async () => {
    try {
      const disk = await reap({
        dirs: {
          inbox: config.inbox, cache: config.cache, trash: config.trash, answers: config.answers,
          marks: config.marks, incoming: config.incoming, logs: config.logs,
        },
        limits: config,
        inUse: store.inUse,
        evictable: store.evictable,
        evict: store.evict,
      })
      if (disk.over) console.log(`[reap] wall holds ${disk.wallBytes} bytes it may not evict, over ${disk.wallMax}`)
      onDisk(disk)
    } catch (err) {
      console.error('[reap] pass failed', err)
    }
  }
  void ready.then(() => {
    void pass()
    setInterval(() => void pass(), config.reapMs).unref()
  })
}
```

- [ ] **Step 7: Wire it into the daemon**

In `server/ingest.ts`, make `watchInbox` return `{ close, ready: watcher.ready }`. `watchTree`'s `ready` resolves once what was already in the inbox has been offered.

In `server/index.ts`: import `startReaper` from `./disk.ts` and `Disk` from `@shared/protocol.ts`. Above `wss.on('connection', …)`:

```ts
let disk: Disk | null = null
```

Assign the existing call, `const inbox = watchInbox((landed) => { … })`, and directly after it:

```ts
startReaper(inbox.ready, (d) => {
  disk = d
  broadcast({ type: 'disk', disk: d })
})
```

Add `disk,` after `build,` in the `hello` snapshot, and `disk,` after `trash: config.trash,` in `/api/health`.

- [ ] **Step 8: Run tests and typecheck**

Run: `npx vitest run server/reap.test.ts server/reaper.test.ts server/evict.test.ts && npx tsc --noEmit`
Expected: PASS. A type error in `src/` about the snapshot's `disk` field is fixed in Task 4. If one appears, finish Task 4 before committing.

- [ ] **Step 9: Commit**

```bash
git add server/config.ts server/reap.ts server/reap.test.ts server/disk.ts server/index.ts server/ingest.ts shared/protocol.ts
git commit -m "reap the trash, cache, answers, marks and logs every 10 minutes, and cap the wall at 20 GB"
```

### Task 4: The `disk` chip on the band

**Files:**
- Modify: `src/useWall.ts`, `src/App.tsx:124`, `src/backends/WebglBackend.tsx` (prop type near line 113, pass-through near 2535), `src/TopBar.tsx` (props near 35 and 68, chip after `daemon stale` at 282), `src/topbar.css`

**Interfaces:**
- Consumes: `Disk` and the `disk` message from Task 3.
- Produces: `useWall()` returns `disk: Disk | null`.

- [ ] **Step 1: Hold it in `useWall`**

```ts
const [disk, setDisk] = useState<Disk | null>(null)
```

In the `snapshot` branch add `setDisk(msg.disk ?? null)`. Add the branch:

```ts
          } else if (msg.type === 'disk') {
            setDisk(msg.disk)
```

Return `disk` beside `daemonStale`, add `disk: Disk | null` to the return type at line 32, and import `Disk` from `@shared/protocol.ts`.

- [ ] **Step 2: Thread it to the band**

In `App.tsx`, take `disk` from `useWall()` and pass `disk={disk}` next to `stale={daemonStale}`. In `WebglBackend.tsx`, add `disk: Disk | null` beside `stale: boolean` in the props type and pass `disk={props.disk}` beside `stale={props.stale}`. In `TopBar.tsx`, add `disk` to the destructured props and `disk: Disk | null` to the type, then after the `daemon stale` chip:

```tsx
          {connected && disk?.over && (
            <span
              className="topbar__disk"
              title={`Pinned cards and eternal zones hold ${gb(disk.wallBytes)} GB, over the wall's ${gb(disk.wallMax)} GB cap. Nothing more can be evicted.`}
            >
              disk
            </span>
          )}
```

with, at module scope in `TopBar.tsx`:

```ts
const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1)
```

- [ ] **Step 3: Style it** (`src/topbar.css`, after `.topbar__stale`)

```css
.topbar__disk {
  color: var(--warn, var(--danger));
  cursor: help;
}
```

- [ ] **Step 4: Typecheck, test, look at it**

Run: `npx tsc --noEmit && npx vitest run src`
Expected: PASS. Then check the chip renders: start the dev daemon with `TRANSOM_WALL_MAX=1 TRANSOM_PORT=8788` and the client against it, or set `disk.over` by hand in the React devtools. Screenshot the band headless and send it with `transom post`.

- [ ] **Step 5: Commit**

```bash
git add src/useWall.ts src/App.tsx src/backends/WebglBackend.tsx src/TopBar.tsx src/topbar.css
git commit -m "show a disk chip on the band when pinned cards exceed the wall's cap"
```

---

## Piece 2: remote senders

### Task 5: The token

**Files:**
- Create: `shared/remote.ts`
- Create: `server/auth.ts`, `server/auth.test.ts`
- Modify: `server/config.ts` (`token: join(root, 'token')`)

**Interfaces:**
- Produces: `PROTOCOL = 1`, in `shared/remote.ts`
- Produces: `loadToken(file: string): Promise<string>`, `isLoopback(addr: string | undefined): boolean`, `allowed(addr, authorization, token): boolean`, `guard(token: string, opts?: { trustLoopback?: boolean }): RequestHandler`

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allowed, isLoopback, loadToken } from './auth.ts'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'transom-auth-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('loadToken', () => {
  it('makes one the first time, readable only by its owner, and reuses it after', async () => {
    const file = join(dir, 'token')
    const first = await loadToken(file)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(await loadToken(file)).toBe(first)
    expect((await readFile(file, 'utf8')).trim()).toBe(first)
  })
})

describe('allowed', () => {
  it('lets loopback through without a token', () => {
    for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(isLoopback(a)).toBe(true)
    expect(allowed('::1', undefined, 't')).toBe(true)
  })
  it('wants the bearer token from anywhere else', () => {
    expect(allowed('192.168.1.9', undefined, 't')).toBe(false)
    expect(allowed('192.168.1.9', 'Bearer nope', 't')).toBe(false)
    expect(allowed('192.168.1.9', 'Bearer t', 't')).toBe(true)
  })
})
```

`guard` captures the token string when it is mounted, which is what keeps a deleted token file harmless. Task 6 tests that.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run server/auth.test.ts`. Expected: FAIL, cannot resolve `./auth.ts`.

- [ ] **Step 3: Implement**

`shared/remote.ts`:

```ts
/** What a remote `bin/transom` and the daemon agree on. `bin/transom` holds
 *  its own copy as TRANSOM_PROTOCOL, and `remote.test.ts` holds them equal. */
export const PROTOCOL = 1
```

`server/auth.ts`:

```ts
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import type { RequestHandler } from 'express'

export async function loadToken(file: string): Promise<string> {
  const held = (await readFile(file, 'utf8').catch(() => '')).trim()
  if (/^[0-9a-f]{64}$/.test(held)) return held
  const made = randomBytes(32).toString('hex')
  await writeFile(file, `${made}\n`, { mode: 0o600 })
  await chmod(file, 0o600)
  return made
}

export const isLoopback = (addr: string | undefined) =>
  addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'

export function allowed(addr: string | undefined, authorization: string | undefined, token: string): boolean {
  if (isLoopback(addr)) return true
  const given = /^Bearer (.+)$/.exec(authorization ?? '')?.[1] ?? ''
  const a = Buffer.from(given)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** `trustLoopback: false` is for tests, which can only ever call from loopback. */
export function guard(token: string, opts: { trustLoopback?: boolean } = {}): RequestHandler {
  const trust = opts.trustLoopback ?? true
  return (req, res, next) => {
    const addr = trust ? req.socket.remoteAddress : undefined
    if (allowed(addr, req.headers.authorization, token)) return next()
    res.status(401).type('text').send('transom: this wall wants its token. Run `transom pair <this host>` on the wall.\n')
  }
}
```

Add `token: join(root, 'token'),` to `config`.

- [ ] **Step 4: Run the test** — `npx vitest run server/auth.test.ts`, expected PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/remote.ts server/auth.ts server/auth.test.ts server/config.ts
git commit -m "give the daemon a token that remote senders must present"
```

### Task 6: Remote routes

**Files:**
- Create: `server/remote.ts`, `server/remote.test.ts`
- Modify: `server/index.ts` (mount, and guard the two marks routes)

**Interfaces:**
- Consumes: `guard`, `loadToken`, `PROTOCOL`, `HELD_EXT` and `kindOf` from `server/kind.ts`, and `save` from `server/atomic.ts`.
- Produces: `mountRemote(app: Express, opts: { token: string; trustLoopback?: boolean; hasFfmpeg?: () => boolean }): void`. The routes are `POST /api/inbox/:zone`, `GET /api/answers/:name`, and `GET /api/whoami`.
- Sidecar fields the CLI sends that the daemon strips before writing: `zoneRoot` (string) and `hued` (string). Bare apps arrive with `path: "@self"`, and the daemon substitutes the inbox path.

- [ ] **Step 1: Write the failing tests** (`server/remote.test.ts`)

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROTOCOL } from '@shared/remote.ts'

let root: string
let server: Server
let base: string

async function start(opts: { hasFfmpeg?: () => boolean } = {}) {
  process.env.TRANSOM_ROOT = root
  vi.resetModules()
  const { mountRemote } = await import('./remote.ts')
  const app = express()
  mountRemote(app, { token: 'tok', trustLoopback: false, ...opts })
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
}

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'transom-remote-')) })
afterEach(async () => {
  server?.close()
  await rm(root, { recursive: true, force: true })
})

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64')
const auth = { Authorization: 'Bearer tok', 'X-Transom-Protocol': String(PROTOCOL) }

function upload(zone: string, body: Buffer | string, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/inbox/${zone}`, {
    method: 'POST',
    headers: { ...auth, 'X-Transom-Name': '.png', 'X-Transom-Sidecar': b64({ caption: 'c' }), ...headers },
    body,
  })
}

describe('POST /api/inbox/:zone', () => {
  it('lands the sidecar, then the file, in the zone, and answers with the path', async () => {
    await start()
    const res = await upload('z', 'png-bytes')
    expect(res.status).toBe(200)
    const { path } = (await res.json()) as { path: string }
    expect(path.startsWith(join(root, 'inbox', 'z') + '/')).toBe(true)
    expect(path.endsWith('.png')).toBe(true)
    expect(await readFile(path, 'utf8')).toBe('png-bytes')
    expect(JSON.parse(await readFile(`${path}.transom.json`, 'utf8')).caption).toBe('c')
  })

  it('writes the zone record from zoneRoot and hued, and keeps both out of the sidecar', async () => {
    await start()
    const res = await upload('z', 'x', { 'X-Transom-Sidecar': b64({ zoneRoot: '/Users/m/src/z', hued: 'background=#123456\n' }) })
    const { path } = (await res.json()) as { path: string }
    expect(JSON.parse(await readFile(join(root, 'zones', 'z.json'), 'utf8'))).toEqual({ root: '/Users/m/src/z', hued: 'background=#123456\n' })
    const side = JSON.parse(await readFile(`${path}.transom.json`, 'utf8'))
    expect(side.zoneRoot).toBeUndefined()
    expect(side.hued).toBeUndefined()
  })

  it('points a bare app at the inbox copy', async () => {
    await start()
    const res = await upload('z', 'x', { 'X-Transom-Sidecar': b64({ apps: [{ name: 'Preview', path: '@self' }] }) })
    const { path } = (await res.json()) as { path: string }
    expect(JSON.parse(await readFile(`${path}.transom.json`, 'utf8')).apps).toEqual([{ name: 'Preview', path }])
  })

  it('refuses without the token, and an old protocol, before reading the body', async () => {
    await start()
    expect((await upload('z', 'x', { Authorization: 'Bearer no' })).status).toBe(401)
    expect((await upload('z', 'x', { 'X-Transom-Protocol': '0' })).status).toBe(426)
    expect(existsSync(join(root, 'inbox'))).toBe(false)
  })

  it('refuses a zone or name that could leave the inbox', async () => {
    await start()
    expect((await upload('..', 'x')).status).toBe(400)
    expect((await upload('a..b', 'x')).status).toBe(400)
    expect((await upload('z', 'x', { 'X-Transom-Name': '/../../evil.png' })).status).toBe(400)
    expect((await upload('z', 'x', { 'X-Transom-Name': '.exe' })).status).toBe(400)
  })

  it('refuses a video when the wall has no ffmpeg', async () => {
    await start({ hasFfmpeg: () => false })
    expect((await upload('z', 'x', { 'X-Transom-Name': '.mp4' })).status).toBe(422)
  })

  it('leaves nothing in the zone when the upload is cut off', async () => {
    await start()
    const ctl = new AbortController()
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('partial'))
        setTimeout(() => ctl.abort(), 50)
      },
    })
    await fetch(`${base}/api/inbox/z`, {
      method: 'POST',
      headers: { ...auth, 'X-Transom-Name': '.png', 'X-Transom-Sidecar': b64({}) },
      body,
      signal: ctl.signal,
      // @ts-expect-error node's fetch needs this for a streamed body
      duplex: 'half',
    }).catch(() => {})
    await new Promise((r) => setTimeout(r, 200))
    const zone = join(root, 'inbox', 'z')
    expect(existsSync(zone) ? readdirSync(zone) : []).toEqual([])
  })

  it('keeps the token it started with after the file is deleted', async () => {
    await start()
    await rm(join(root, 'token'), { force: true })
    expect((await upload('z', 'x')).status).toBe(200)
  })
})

describe('GET /api/answers/:name', () => {
  it('waits for the answer, hands it over once, and deletes it', async () => {
    await start()
    setTimeout(async () => {
      await mkdir(join(root, 'answers'), { recursive: true })
      await writeFile(join(root, 'answers', 'q.png'), 'answered\nleft\n')
    }, 300)
    const res = await fetch(`${base}/api/answers/q.png?wait=5`, { headers: auth })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('answered\nleft\n')
    expect(existsSync(join(root, 'answers', 'q.png'))).toBe(false)
  })
  it('says 204 when nothing came in time', async () => {
    await start()
    expect((await fetch(`${base}/api/answers/q.png?wait=1`, { headers: auth })).status).toBe(204)
  })
  it('refuses a name with a path in it', async () => {
    await start()
    expect((await fetch(`${base}/api/answers/..%2Fsettings.json`, { headers: auth })).status).toBe(400)
  })
})

describe('GET /api/whoami', () => {
  it('names the wall to a sender holding the token', async () => {
    await start()
    const res = await fetch(`${base}/api/whoami`, { headers: auth })
    expect(res.status).toBe(200)
    expect(typeof ((await res.json()) as { host: string }).host).toBe('string')
  })
})
```

- [ ] **Step 2: Run to see it fail** — `npx vitest run server/remote.test.ts`, expected FAIL on the missing module.

- [ ] **Step 3: Implement `server/remote.ts`**

```ts
import { randomUUID } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'
import type { Express, RequestHandler } from 'express'
import { PROTOCOL } from '@shared/remote.ts'
import { config } from './config.ts'
import { guard } from './auth.ts'
import { save } from './atomic.ts'
import { HELD_EXT, kindOf } from './kind.ts'

const ZONE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/
/** `.ttl30m.png`, `.png`: the part of the name `bin/transom` puts after its UUID. */
const SUFFIX = /^(\.ttl[A-Za-z0-9:-]+)?(\.[a-z0-9]+)$/
const FILE = /^[A-Za-z0-9._-]+$/

const sameProtocol: RequestHandler = (req, res, next) => {
  if (req.headers['x-transom-protocol'] === String(PROTOCOL)) return next()
  res.status(426).type('text').send(`transom: this wall speaks protocol ${PROTOCOL}. Run brew upgrade transom on the sending host.\n`)
}

let ffmpeg: boolean | undefined
const ffmpegHere = () => (ffmpeg ??= spawnSync(config.ffmpeg, ['-version'], { stdio: 'ignore' }).status === 0)

function decodeSidecar(header: string | string[] | undefined): Record<string, unknown> | null {
  if (typeof header !== 'string') return {}
  try {
    const blob = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
    return blob && typeof blob === 'object' && !Array.isArray(blob) ? blob : null
  } catch {
    return null
  }
}

export function mountRemote(
  app: Express,
  opts: { token: string; trustLoopback?: boolean; hasFfmpeg?: () => boolean },
) {
  const gate = guard(opts.token, { trustLoopback: opts.trustLoopback })
  const hasFfmpeg = opts.hasFfmpeg ?? ffmpegHere

  app.post('/api/inbox/:zone', gate, sameProtocol, async (req, res) => {
    const zone = req.params.zone
    const suffix = SUFFIX.exec(String(req.headers['x-transom-name'] ?? ''))
    if (!ZONE.test(zone) || zone.includes('..') || !suffix || !HELD_EXT.includes(suffix[2]!))
      return void res.status(400).type('text').send('transom: no such zone or kind of file\n')
    const side = decodeSidecar(req.headers['x-transom-sidecar'])
    if (!side) return void res.status(400).type('text').send('transom: unreadable sidecar\n')
    const dest = join(config.inbox, zone, `${randomUUID()}${suffix[0]}`)
    if (kindOf(dest) === 'video' && !hasFfmpeg())
      return void res.status(422).type('text').send('transom: the wall has no ffmpeg for the poster frame. brew install ffmpeg on the wall.\n')
    if (Number(req.headers['content-length'] ?? 0) > config.uploadMaxBytes)
      return void res.status(413).type('text').send('transom: over the 2 GB a send may be\n')

    // Into .incoming first: a body cut off partway never reaches a zone, and
    // the reaper deletes it within the hour.
    await mkdir(config.incoming, { recursive: true })
    const part = join(config.incoming, randomUUID())
    let bytes = 0
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > config.uploadMaxBytes) req.destroy()
    })
    try {
      await pipeline(req, createWriteStream(part))
    } catch {
      await rm(part, { force: true })
      if (!res.headersSent) res.status(bytes > config.uploadMaxBytes ? 413 : 400).end()
      return
    }

    const { zoneRoot, hued, ...stamp } = side
    if (Array.isArray(stamp.apps))
      stamp.apps = stamp.apps.map((a: { name?: unknown; path?: unknown }) => (a?.path === '@self' ? { ...a, path: dest } : a))
    await mkdir(join(config.inbox, zone), { recursive: true })
    if (typeof zoneRoot === 'string' && zoneRoot !== '') {
      await mkdir(join(config.root, 'zones'), { recursive: true })
      const record = typeof hued === 'string' ? { root: zoneRoot, hued } : { root: zoneRoot }
      await save(join(config.root, 'zones', `${zone}.json`), `${JSON.stringify(record)}\n`)
    }
    // The sidecar before the image: the image arriving is what ingest triggers on.
    await save(`${dest}.transom.json`, `${JSON.stringify(stamp)}\n`)
    await rename(part, dest)
    res.json({ path: dest })
  })

  app.get('/api/answers/:name', gate, sameProtocol, async (req, res) => {
    const name = req.params.name
    if (!FILE.test(name) || name.includes('..')) return void res.status(400).end()
    const file = join(config.answers, name)
    const until = Date.now() + Math.min(Number(req.query.wait ?? 0), 60) * 1000
    for (;;) {
      if (existsSync(file)) {
        const text = await readFile(file, 'utf8')
        await rm(file, { force: true })
        return void res.type('text').send(text)
      }
      if (Date.now() >= until || req.socket.destroyed) return void res.status(204).end()
      await new Promise((r) => setTimeout(r, 250))
    }
  })

  app.get('/api/whoami', gate, sameProtocol, (_req, res) => {
    res.json({ host: hostname() })
  })
}
```

Check `server/atomic.ts` `save`'s signature before relying on it: `save(file: string, text: string)` (line 23). It is.

- [ ] **Step 4: Mount it and guard marks in `server/index.ts`**

With the imports, add `import { loadToken, guard } from './auth.ts'` and `import { mountRemote } from './remote.ts'`. After the `await mkdir(config.cache…)` line:

```ts
const token = await loadToken(config.token)
mountRemote(app, { token })
```

Change the two marks routes to take the guard as middleware:

```ts
app.post('/api/marks/claim', guard(token), express.json(), async (req, res) => {
app.get('/api/marks/:file', guard(token), (req, res) => {
```

- [ ] **Step 5: Run the tests** — `npx vitest run server/remote.test.ts server/auth.test.ts && npx tsc --noEmit`, expected PASS. If the cut-off test is flaky because the abort lands after the stream finished, enqueue more data before aborting and never call `c.close()`. The test is only meaningful while the request is still open.

- [ ] **Step 6: Commit**

```bash
git add server/remote.ts server/remote.test.ts server/index.ts
git commit -m "accept renders and serve answers over HTTP to token-holding senders"
```

### Task 7: Senders on another host

**Files:**
- Modify: `server/markup.ts` (`Sender` gains `host`, `isLive` handles remote, `sawSession`)
- Modify: `server/sidecar.ts:23` (add `'host'` to the string keys), `server/xmp.ts` (`Stamp.host?: string`)
- Modify: `server/ingest.ts:134-135` (carry `host` into the sender)
- Modify: `server/index.ts` (`marks/claim` calls `sawSession`)
- Modify: `server/zoneColors.ts` (prefer `hued` from the record; do not watch a root that has one)
- Tests: `server/markup.remote.test.ts`, `server/zoneColors.test.ts` (add a case)

**Interfaces:**
- Produces: `Sender = { session: string; pid?: number; host?: string }`, `sawSession(session: string, now?: number): void`, `isLive(sender, now?: number): Promise<boolean>`, and `REMOTE_LIVE_MS = 120_000`.

- [ ] **Step 1: Write the failing tests**

`server/markup.remote.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isLive, sawSession, REMOTE_LIVE_MS } from './markup.ts'

describe('a sender on another host', () => {
  it('is live while its session has asked the wall for marks recently', async () => {
    const sender = { session: 's-remote', pid: 99999, host: 'studio' }
    expect(await isLive(sender, 1_000_000)).toBe(false)
    sawSession('s-remote', 1_000_000)
    expect(await isLive(sender, 1_000_000 + REMOTE_LIVE_MS - 1)).toBe(true)
    expect(await isLive(sender, 1_000_000 + REMOTE_LIVE_MS + 1)).toBe(false)
  })
})
```

Add to `server/zoneColors.test.ts`, following its existing setup (read the file first and reuse its helpers for the temp root and for calling `readZoneHued`):

```ts
it('takes the color from the record when the sender sent its .hued', async () => {
  // zones/remote.json: { "root": "/does/not/exist", "hued": "<a .hued body the existing tests use>" }
  // expect the zone's background to be the one in that body
})
```

Write the body with the exact `.hued` text and assertion shape the file's other cases use. They call `readZoneHued()` and check `pick(..., 'background')`.

- [ ] **Step 2: Run to see them fail** — `npx vitest run server/markup.remote.test.ts server/zoneColors.test.ts`.

- [ ] **Step 3: Implement**

In `server/markup.ts`:

```ts
export type Sender = { session: string; pid?: number; host?: string }

/** How recently a session on another host must have asked for its marks to
 *  count as running. Its hook asks on every tool call, so two minutes of
 *  silence is a session that has stopped. */
export const REMOTE_LIVE_MS = 120_000
const lastSeen = new Map<string, number>()

export function sawSession(session: string, now = Date.now()) {
  lastSeen.set(session, now)
}
```

At the top of `isLive`, change the signature to `isLive(sender: Sender | undefined, now = Date.now())` and add first:

```ts
  if (sender?.host) {
    const seen = lastSeen.get(sender.session)
    return seen !== undefined && now - seen < REMOTE_LIVE_MS
  }
```

In `server/sidecar.ts`, add `'host'` to the key list on line 23. In `server/xmp.ts`'s `Stamp`, add:

```ts
  /** The Mac a remote send came from. Absent for a send from this one. */
  host?: string
```

In `server/ingest.ts` lines 134–135:

```ts
  const sender = sidecar?.session
    ? { session: sidecar.session, ...(sidecar.pid ? { pid: sidecar.pid } : {}), ...(sidecar.host ? { host: sidecar.host } : {}) }
    : undefined
```

(Keep whatever the existing expression ends with. Read lines 130–140 first and change only the object literal.)

In `server/index.ts`'s `marks/claim` handler, after the `session` check:

```ts
  marks.sawSession(session)
```

`index.ts` imports only `pngOf` from `./markup.ts`, so add `sawSession` to that import and call it bare.

In `server/zoneColors.ts`, in `readZoneHued` (line 49):

```ts
        const { root, hued } = JSON.parse(await readFile(join(zonesDir, name), 'utf8'))
        if (typeof hued === 'string') return void (out[zone] = parseHued(hued))
        if (typeof root !== 'string' || !root) return
```

and in the watcher's loop (line 78):

```ts
            const { root, hued } = JSON.parse(await readFile(join(zonesDir, name), 'utf8'))
            if (typeof hued !== 'string' && typeof root === 'string' && root) roots.push(join(root, '.hued'))
```

- [ ] **Step 4: Run the tests** — `npx vitest run server/markup.remote.test.ts server/zoneColors.test.ts server/sidecar.test.ts server/watchInbox.test.ts && npx tsc --noEmit`, expected PASS.

- [ ] **Step 5: Commit**

```bash
git add server/markup.ts server/markup.remote.test.ts server/sidecar.ts server/xmp.ts server/ingest.ts server/index.ts server/zoneColors.ts server/zoneColors.test.ts
git commit -m "color a remote zone from its sent .hued, and judge a remote sender live by its last claim"
```

### Task 8: Remote mode in `bin/transom`

**Files:**
- Create: `libexec/remote.sh` (sourced, so `bin/transom` does not grow)
- Modify: `bin/transom`: a `protocol` verb, source `remote.sh`, `sidecar_json` split out of `write_sidecar`, and the remote branches in the send loop, the stdin send, `await_answer` and the ffmpeg check
- Create: `server/remote.cli.test.ts`

**Interfaces:**
- Consumes: the Task 6 routes and `PROTOCOL`.
- Produces: `transom protocol` prints `1`. In remote mode `post`/`ask` print the wall host's inbox path, and `ask` exits 0/3/4/5 as it does locally. Exit 6 means the wall did not answer the initial send.
- Shell functions in `libexec/remote.sh`: `remote_on`, `remote_send FILE_OR_DASH SUFFIX ZONE SIDECAR_JSON` (prints the path), and `remote_await NAME DEST`.

- [ ] **Step 1: Write the failing tests** (`server/remote.cli.test.ts`)

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROTOCOL } from '@shared/remote.ts'

const TRANSOM = fileURLToPath(new URL('../bin/transom', import.meta.url))

let wall: string   // the wall host's TRANSOM_ROOT
let node: string   // the sender's TRANSOM_ROOT
let server: Server
let url: string

beforeEach(async () => {
  wall = await mkdtemp(join(tmpdir(), 'transom-wall-'))
  node = await mkdtemp(join(tmpdir(), 'transom-node-'))
  process.env.TRANSOM_ROOT = wall
  vi.resetModules()
  const { mountRemote } = await import('./remote.ts')
  const app = express()
  mountRemote(app, { token: 'tok', trustLoopback: false })
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const a = server.address()
  url = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`
  await writeFile(join(node, 'wall.env'), `TRANSOM_WALL=${url}\nTRANSOM_TOKEN=tok\n`)
  await writeFile(join(node, 'shot.png'), 'png')
})
afterEach(async () => {
  server.close()
  await rm(wall, { recursive: true, force: true })
  await rm(node, { recursive: true, force: true })
})

function run(args: string[], env: Record<string, string> = {}) {
  const child = spawn('sh', [TRANSOM, ...args], {
    env: { ...process.env, TRANSOM_ROOT: node, TRANSOM_ZONE: 'z', CLAUDE_CODE_SESSION_ID: 'sess-1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: node,
  })
  let out = ''
  let err = ''
  child.stdout.on('data', (d) => (out += d))
  child.stderr.on('data', (d) => (err += d))
  return new Promise<{ code: number | null; out: string; err: string }>((r) =>
    child.on('exit', (code) => r({ code, out, err })),
  )
}

describe('remote mode', () => {
  it('agrees with the daemon on the protocol', async () => {
    expect((await run(['protocol'])).out.trim()).toBe(String(PROTOCOL))
  })

  it('posts to the wall host and prints where it landed there', async () => {
    const { code, out } = await run(['post', '--caption', 'hi', 'shot.png'])
    expect(code).toBe(0)
    const path = out.trim()
    expect(path.startsWith(join(wall, 'inbox', 'z'))).toBe(true)
    expect(await readFile(path, 'utf8')).toBe('png')
    const side = JSON.parse(await readFile(`${path}.transom.json`, 'utf8'))
    expect(side.caption).toBe('hi')
    expect(typeof side.host).toBe('string')
    expect(side.session).toBe('sess-1')
  })

  it('marks the session as one that sent remotely, for the hook', async () => {
    await run(['post', 'shot.png'])
    await expect(readFile(join(node, 'remote-sessions', 'sess-1'), 'utf8')).resolves.toBe('')
  })

  it('asks across hosts and prints the answer', async () => {
    const child = run(['ask', 'which?', '--choice', 'left', 'shot.png'])
    // Play the store: answer once the image lands on the wall host.
    for (;;) {
      const dir = join(wall, 'inbox', 'z')
      const { readdirSync, existsSync } = await import('node:fs')
      const sent = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith('.png')) : undefined
      if (sent) {
        await mkdir(join(wall, 'answers'), { recursive: true })
        await writeFile(join(wall, 'answers', sent), 'answered\nleft\n')
        break
      }
      await new Promise((r) => setTimeout(r, 50))
    }
    const { code, out } = await child
    expect(code).toBe(0)
    expect(out.trim().split('\n').pop()).toBe('left')
  })

  it('keeps waiting through a wall that drops off mid-question', async () => {
    const child = run(['ask', 'which?', 'shot.png'])
    let sent: string | undefined
    const { readdirSync, existsSync } = await import('node:fs')
    while (!sent) {
      const dir = join(wall, 'inbox', 'z')
      sent = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith('.png')) : undefined
      await new Promise((r) => setTimeout(r, 50))
    }
    server.close()
    server.closeAllConnections()
    await new Promise((r) => setTimeout(r, 1500))
    const port = Number(new URL(url).port)
    const { mountRemote } = await import('./remote.ts')
    const app = express()
    mountRemote(app, { token: 'tok', trustLoopback: false })
    server = app.listen(port)
    await mkdir(join(wall, 'answers'), { recursive: true })
    await writeFile(join(wall, 'answers', sent), 'answered\n\nfine\n')
    const { code, out } = await child
    expect(code).toBe(0)
    expect(out.trim().split('\n').pop()).toBe('fine')
  }, 20_000)

  it('exits 6 when the wall is not answering', async () => {
    await writeFile(join(node, 'wall.env'), 'TRANSOM_WALL=http://127.0.0.1:1\nTRANSOM_TOKEN=tok\n')
    const { code, err } = await run(['post', 'shot.png'])
    expect(code).toBe(6)
    expect(err).toContain('the wall at http://127.0.0.1:1 is not answering')
  })

  it('drops an --app that names a file on this host, and keeps a bare one', async () => {
    const { out, err } = await run(['post', '--app', 'Preview', '--app', 'LDView=parts/x.dat', 'shot.png'])
    const side = JSON.parse(await readFile(`${out.trim()}.transom.json`, 'utf8'))
    expect(side.apps).toEqual([{ name: 'Preview', path: out.trim() }])
    expect(err).toContain('LDView')
  })
})
```

Add a protocol-agreement check in the style of `kind.test.ts`'s `held_ext` test: read `bin/transom` and assert `TRANSOM_PROTOCOL=1` matches `PROTOCOL`. Put it in this file.

- [ ] **Step 2: Run to see them fail** — `npx vitest run server/remote.cli.test.ts`, expected FAIL (no `protocol` verb, local writes).

- [ ] **Step 3: Write `libexec/remote.sh`**

```sh
# Remote mode for bin/transom: sourced, not run. On when $transom_root/wall.env
# exists, which `transom pair` writes from the wall host.

TRANSOM_PROTOCOL=1

remote_on() { [ -f "$transom_root/wall.env" ]; }

remote_load() {
  # shellcheck disable=SC1091
  . "$transom_root/wall.env"
  [ -n "${TRANSOM_WALL:-}" ] && [ -n "${TRANSOM_TOKEN:-}" ] || fail "wall.env names no wall or no token. Run transom pair on the wall host."
}

remote_curl() {
  curl -sS --connect-timeout 3 \
    -H "Authorization: Bearer $TRANSOM_TOKEN" \
    -H "X-Transom-Protocol: $TRANSOM_PROTOCOL" "$@"
}

# FILE (or - for stdin), the name suffix, the zone, the sidecar JSON. Prints the
# path the wall host gave it.
remote_send() {
  side=$(printf '%s' "$4" | base64 | tr -d '\n')
  body=$(mktemp "${TMPDIR:-/tmp}/transom-reply.XXXXXX")
  code=$(remote_curl -o "$body" -w '%{http_code}' \
    -H "X-Transom-Name: $2" -H "X-Transom-Sidecar: $side" \
    --data-binary "@$1" "$TRANSOM_WALL/api/inbox/$3") || code=000
  if [ "$code" = 000 ]; then
    rm -f "$body"
    echo "transom $verb: the wall at $TRANSOM_WALL is not answering" >&2
    exit 6
  fi
  if [ "$code" != 200 ]; then
    cat "$body" >&2; rm -f "$body"; exit 1
  fi
  sed -n 's/.*"path":"\([^"]*\)".*/\1/p' "$body"
  rm -f "$body"
}

# Long-polls for the answer to NAME and writes it to DEST, where await_answer
# reads it as though the local daemon had. A wall that has gone away is waited
# out: a question can outlast a laptop lid.
remote_await() {
  mkdir -p "$(dirname "$2")"
  while :; do
    code=$(remote_curl -m 40 -o "$2.part" -w '%{http_code}' "$TRANSOM_WALL/api/answers/$1?wait=30") || code=000
    case "$code" in
      200) mv "$2.part" "$2"; return 0 ;;
      204) rm -f "$2.part" ;;
      000) rm -f "$2.part"; sleep 2 ;;
      *) cat "$2.part" >&2; rm -f "$2.part"; exit 1 ;;
    esac
  done
}
```

- [ ] **Step 4: Wire it into `bin/transom`**

1. In the verb `case` near line 81, add `protocol) echo 1; exit 0 ;;`, a literal `1` because `remote.sh` is not sourced yet at that point. The agreement test reads `TRANSOM_PROTOCOL=1` from `remote.sh`; point it at that file rather than `bin/transom`.
2. After `transom_root=…` (line 300), add `. "$TRANSOM_HOME/libexec/remote.sh"` and then `remote_on && remote_load`.
3. Split `write_sidecar` into `sidecar_json` (the `{ … }` block, printing to stdout, taking `dest_image` and `dest_caption`) and a `write_sidecar` that does `sidecar_json "$@" > "$1.transom.json"`, keeping the early-return guard in `write_sidecar` only. In remote mode the sidecar is always sent, because it carries `host`.
4. In `sidecar_json`, when `remote_on`, also print `,"host":"<scutil --get LocalHostName>"`, `,"zoneRoot":"<$root>"`, and, when `$root/.hued` exists, `,"hued":"<json_escape of its contents>"`.
5. In `apps_json`, when `remote_on`: for a bare `Name`, print `"path":"@self"`; for `Name=path`, skip the entry and `echo "transom $verb: --app $name names a file on this host, so the wall cannot open it" >&2`.
6. Wrap the ffmpeg refusal (line ~389) in `if ! remote_on; then … fi`.
7. In the stdin branch (`if [ $# -eq 0 ]`) and the per-file loop, when `remote_on`, replace the `write_sidecar`/`cat`/`cp`/`echo "$dest"` lines with:

```sh
    dest=$(remote_send "$f" "$suffix.$ext" "$zone" "$(sidecar_json "$f" "$own")")
    echo "$dest"
    if [ -n "$session" ]; then mkdir -p "$transom_root/remote-sessions"; : > "$transom_root/remote-sessions/$session"; fi
```

   using `-` for `$f` and `png` for `$ext` in the stdin branch, and skip the `zones/<zone>.json` write (lines 362–365) when `remote_on`, since the daemon writes the zone record.
8. In `await_answer`, right after `answer=…`, add `remote_on && remote_await "$(basename "$1")" "$answer"`. The existing `while [ ! -f "$answer" ]` loop then finds the file at once.

- [ ] **Step 5: Run the CLI tests and the existing ones it could break**

Run: `npx vitest run server/remote.cli.test.ts server/ask.test.ts server/repoSettings.cli.test.ts server/kind.test.ts`
Expected: PASS. `ask.test.ts` runs with no `wall.env` and must pass unchanged, since that is the local path.

- [ ] **Step 6: Commit**

```bash
git add libexec/remote.sh bin/transom server/remote.cli.test.ts
git commit -m "send to a wall on another Mac when wall.env names one"
```

### Task 9: The hook collects marks from a remote wall

**Files:**
- Modify: `hooks/wall-nudge.mjs`
- Modify: `hooks/wall-nudge.test.mjs`

**Interfaces:**
- Consumes: `POST /api/marks/claim` and `GET /api/marks/:id.png` with the token; `$TRANSOM_ROOT/remote-sessions/<session>` from Task 8. `claimed` entries are `{ id, caption, zone, image, text }` (from `store.claimMarks`).
- Produces: `wallEnv(root?): { wall: string; token: string } | null`, `sentRemotely(session, root?): boolean`, `claimRemote(session, env, root?): Promise<Claimed[]>` (each `image` rewritten to the local copy), and `pruneRemote(root?, now?): void`.

- [ ] **Step 1: Write the failing tests** (append to `hooks/wall-nudge.test.mjs`, reusing its temp-root setup)

```js
import http from 'node:http'

describe('a remote wall', () => {
  it('reads wall.env', () => {
    fs.writeFileSync(path.join(root, 'wall.env'), 'TRANSOM_WALL=http://w:8787\nTRANSOM_TOKEN=tok\n')
    expect(wallEnv(root)).toEqual({ wall: 'http://w:8787', token: 'tok' })
  })

  it('claims with the token and keeps a local copy of each drawing', async () => {
    const server = http.createServer((req, res) => {
      expect(req.headers.authorization).toBe('Bearer tok')
      if (req.url === '/api/marks/claim') {
        res.setHeader('Content-Type', 'application/json')
        return res.end(JSON.stringify({ ok: true, claimed: [{ id: 'abc', caption: 'c', zone: 'z', image: '/wall/marks/abc.png', text: '' }] }))
      }
      if (req.url === '/api/marks/abc.png') return res.end('PNG')
      res.statusCode = 404
      res.end()
    })
    await new Promise((r) => server.listen(0, r))
    const env = { wall: `http://127.0.0.1:${server.address().port}`, token: 'tok' }
    const got = await claimRemote('s1', env, root)
    server.close()
    expect(got[0].image).toBe(path.join(root, 'marks', 'abc.png'))
    expect(fs.readFileSync(got[0].image, 'utf8')).toBe('PNG')
  })

  it('forgets session markers and drawings after a day', () => {
    fs.mkdirSync(path.join(root, 'remote-sessions'), { recursive: true })
    fs.mkdirSync(path.join(root, 'marks'), { recursive: true })
    fs.writeFileSync(path.join(root, 'remote-sessions', 's1'), '')
    fs.writeFileSync(path.join(root, 'marks', 'abc.png'), 'PNG')
    pruneRemote(root, Date.now() + 25 * 3_600_000)
    expect(fs.existsSync(path.join(root, 'remote-sessions', 's1'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'marks', 'abc.png'))).toBe(false)
  })
})
```

Match the file's existing import style for `fs`/`path`, and import the new names from `./wall-nudge.mjs`.

- [ ] **Step 2: Run to see them fail** — `npx vitest run hooks/wall-nudge.test.mjs`.

- [ ] **Step 3: Implement** (in `hooks/wall-nudge.mjs`, after `claimMarks`)

```js
const DAY_MS = 86_400_000

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

export function sentRemotely(session, root = transomRoot()) {
  if (typeof session !== 'string' || session === '') return false
  return existsSync(path.join(root, 'remote-sessions', session.replace(/[^A-Za-z0-9._-]/g, '_')))
}

/** Claims from the wall host, and swaps each drawing's path there for a copy
 *  here — the session cannot read the wall host's disk. */
export async function claimRemote(session, env, root = transomRoot()) {
  const headers = { Authorization: `Bearer ${env.token}`, 'X-Transom-Protocol': '1' }
  try {
    const res = await fetch(`${env.wall}/api/marks/claim`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
      signal: AbortSignal.timeout(2000),
    })
    const body = await res.json()
    const claimed = Array.isArray(body?.claimed) ? body.claimed : []
    mkdirSync(path.join(root, 'marks'), { recursive: true })
    for (const c of claimed) {
      const png = await fetch(`${env.wall}/api/marks/${c.id}.png`, { headers, signal: AbortSignal.timeout(5000) })
      const local = path.join(root, 'marks', `${c.id}.png`)
      writeFileSync(local, Buffer.from(await png.arrayBuffer()))
      c.image = local
    }
    return claimed
  } catch {
    return []
  }
}

export function pruneRemote(root = transomRoot(), now = Date.now()) {
  for (const dir of ['remote-sessions', 'marks']) {
    let names = []
    try { names = readdirSync(path.join(root, dir)) } catch { continue }
    for (const n of names) {
      const p = path.join(root, dir, n)
      try {
        const st = statSync(p)
        if (st.isFile() && Math.max(st.mtimeMs, st.ctimeMs) < now - DAY_MS) rmSync(p)
      } catch {}
    }
  }
}
```

Add `readdirSync` and `rmSync` to the `node:fs` import. In the main block, replace the `const marked = …` line with:

```js
  const env = sentRemotely(p?.session_id) ? wallEnv() : null
  if (env) pruneRemote()
  const claimed = env
    ? await claimRemote(p.session_id, env)
    : marksWaiting(p?.session_id) ? await claimMarks(p.session_id) : []
  const marked = marksMessage(claimed)
```

`marksMessage([])` returns `''`, so the exit logic below does not change.

- [ ] **Step 4: Run the tests** — `npx vitest run hooks/wall-nudge.test.mjs`, expected PASS.

- [ ] **Step 5: Commit**

```bash
git add hooks/wall-nudge.mjs hooks/wall-nudge.test.mjs
git commit -m "collect marked-up renders from a remote wall in the hook"
```

### Task 10: `transom pair`, and the docs

**Files:**
- Create: `libexec/pair`
- Create: `server/pair.cli.test.ts`
- Modify: `bin/transom` (dispatch `pair`; the header usage text)
- Modify: `README.md` (a "Sending from another Mac" section under *Running it*)
- Modify: `skills/transom/SKILL.md` (diagnosing a remote node: `wall.env`, exit 6, 401, 426)
- Modify: `DESIGN.md` (a *Remote senders* section, and the reaper under *Rescue, expiry, and the trash*, replacing "nothing reads it")
- Delete: `docs/superpowers/specs/2026-10-05-remote-senders-design.md` and this plan, once their content is in `DESIGN.md`

**Interfaces:**
- Consumes: `transom protocol` (Task 8), `GET /api/whoami` (Task 6), `~/transom/token` (Task 5).
- Produces: `transom pair [--head] HOST` and `transom pair --off HOST`.

- [ ] **Step 1: Write the failing test** (`server/pair.cli.test.ts`)

Stub `ssh` and `brew` on `PATH`. The `ssh` stub drops its host argument and runs the command locally with `HOME` set to a temp "node home", so the test checks what `pair` writes without a network:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
  // Drops ssh's options and host, then runs the command as the node.
  // pair calls `ssh -o BatchMode=yes HOST CMD`: drop the option and the host.
  await stub('ssh', `shift 3; HOME=${nodeHome} TRANSOM_ROOT=${nodeHome}/transom exec sh -c "$*"`)
  await stub('brew', 'exit 0')
  await stub('transom', `exec sh ${TRANSOM} "$@"`)
  await stub('curl', 'echo \'{"host":"wall"}\'')
  await stub('scutil', 'echo wallhost')
})
afterEach(async () => {
  for (const d of [wall, nodeHome, stubs]) await rm(d, { recursive: true, force: true })
})

function pair(args: string[]) {
  const child = spawn('sh', [TRANSOM, 'pair', ...args], {
    env: { ...process.env, PATH: `${stubs}:${process.env.PATH}`, TRANSOM_ROOT: wall },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = '', err = ''
  child.stdout.on('data', (d) => (out += d))
  child.stderr.on('data', (d) => (err += d))
  return new Promise<{ code: number | null; out: string; err: string }>((r) => child.on('exit', (code) => r({ code, out, err })))
}

describe('transom pair', () => {
  it('writes wall.env on the node, readable only by its owner', async () => {
    const { code, err } = await pair(['studio'])
    expect(err).toBe('')
    expect(code).toBe(0)
    const env = join(nodeHome, 'transom', 'wall.env')
    expect(await readFile(env, 'utf8')).toBe(`TRANSOM_WALL=http://wallhost.local:8787\nTRANSOM_TOKEN=${'a'.repeat(64)}\n`)
    expect((await stat(env)).mode & 0o777).toBe(0o600)
  })
  it('refuses on a wall with no token yet', async () => {
    await rm(join(wall, 'token'))
    expect((await pair(['studio'])).code).not.toBe(0)
  })
  it('takes it back out with --off', async () => {
    await pair(['studio'])
    await pair(['--off', 'studio'])
    expect(existsSync(join(nodeHome, 'transom', 'wall.env'))).toBe(false)
  })
})
```

`transom wire` runs for real inside the stub `ssh`, against the temp `HOME`. If it changes anything outside `$HOME`, set `TRANSOM_PAIR_NO_WIRE=1` in the test env and honor it in `libexec/pair`. Check `libexec/wire.mjs` first: it uses `homedir()`, which follows `HOME`, so it should stay inside the temp directory.

- [ ] **Step 2: Run to see it fail** — `npx vitest run server/pair.cli.test.ts`.

- [ ] **Step 3: Write `libexec/pair`**

```sh
#!/bin/sh
# `transom pair HOST`: let another Mac send to the wall on this one. Run on the
# wall host, which can reach the fleet over ssh when the fleet cannot reach it.
#
#   transom pair studio          install transom there and point it here
#   transom pair --head studio   the same, from the tap's HEAD
#   transom pair --off studio    stop it sending here; leaves the install
set -eu

fail() { echo "transom pair: $1" >&2; exit 1; }

off="" head=""
while :; do
  case "${1:-}" in
    --off) off=1; shift ;;
    --head) head=1; shift ;;
    -?*) fail "no such flag: $1" ;;
    *) break ;;
  esac
done
[ $# -eq 1 ] || fail "takes one host: transom pair studio"
host=$1
on() { ssh -o BatchMode=yes "$host" "PATH=/opt/homebrew/bin:\$PATH; $1"; }

if [ -n "$off" ]; then
  on 'rm -f ~/transom/wall.env'
  echo "$host no longer sends to this wall"
  exit 0
fi

root="${TRANSOM_ROOT:-$HOME/transom}"
[ -f "$root/token" ] || fail "no token yet. The daemon makes one when it starts: transom up"
token=$(tr -d '\n' < "$root/token")
wall="http://$(scutil --get LocalHostName).local:${TRANSOM_PORT:-8787}"

if [ -n "$head" ]; then
  on 'brew install --HEAD orochi235/tap/transom 2>/dev/null || brew upgrade --fetch-HEAD orochi235/tap/transom'
else
  on 'brew install orochi235/tap/transom 2>/dev/null; brew upgrade orochi235/tap/transom 2>/dev/null || true'
fi
[ "$(on 'transom protocol' 2>/dev/null || true)" = 1 ] ||
  fail "$host's transom cannot send remotely yet. Publish a release, or pair with --head."
on 'transom wire' >/dev/null
printf 'TRANSOM_WALL=%s\nTRANSOM_TOKEN=%s\n' "$wall" "$token" |
  on 'umask 077; mkdir -p ~/transom; cat > ~/transom/wall.env'
on '. ~/transom/wall.env; curl -sf -m 5 -H "Authorization: Bearer $TRANSOM_TOKEN" -H "X-Transom-Protocol: 1" "$TRANSOM_WALL/api/whoami"' >/dev/null ||
  fail "$host has the token but cannot reach $wall"
echo "$host sends to $wall"
```

In `bin/transom`'s verb `case`, add `pair) exec sh "$TRANSOM_HOME/libexec/pair" "$@" ;;` and a usage line under `transom wire`:

```
#   transom pair HOST             lets another Mac send here (run on the wall)
```

Bump the `sed -n '2,63p'` range in `usage()` by one line.

The `~/transom` in `on '…'` strings stays literal for the remote shell to expand. The test's stub sets `HOME` and `TRANSOM_ROOT` to the node's temp directory, so the two agree.

- [ ] **Step 4: Run the test** — `npx vitest run server/pair.cli.test.ts`, expected PASS.

- [ ] **Step 5: Docs.** Add to `README.md` under *Running it*:

````md
### Sending from another Mac

On the Mac the wall runs on:

```
transom pair studio
```

That installs transom on `studio` over ssh, wires its Claude Code agents, and
gives it this wall's address and token. Renders sent there land here. `transom
pair --off studio` stops it.
````

Add to `skills/transom/SKILL.md`'s diagnosis list: a node with `~/transom/wall.env` sends over HTTP. Exit 6 means the wall host is asleep or off the LAN, 401 means a stale token (run `transom pair <node>` again on the wall), and 426 means `brew upgrade transom` on the node.

In `DESIGN.md`: replace the paragraph starting "**Expiry moves to a holding trash — which is never emptied.**" with a description of the reaper (the table from the spec, plus the ctime point). Add a `## Remote senders` section after *Asking for the screen*, holding the spec's transport, authentication, cross-host fixes and `pair`, without the "Why the bounding comes first" history. Then delete the spec and this plan:

```bash
git rm docs/superpowers/specs/2026-10-05-remote-senders-design.md docs/superpowers/plans/2026-10-05-remote-senders.md
```

- [ ] **Step 6: Full local check of the diff's tests, then commit**

Run: `npx tsc --noEmit && npx vitest run server hooks shared`
Expected: PASS.

```bash
git add libexec/pair server/pair.cli.test.ts bin/transom README.md skills/transom/SKILL.md DESIGN.md
git commit -m "add transom pair, which sets up another Mac to send to this wall"
```

### Task 11: Live check on the fleet (needs Mike)

Nothing here is automated, and two steps are outward-facing.

- [ ] **Step 1:** `npm run daemon:restart`, then `npm run doctor`. Check that `~/transom/token` exists and that `/api/health` shows `disk`. Within 10 minutes of the restart the trash drops from about 3.8 GB to the last 24h. Report the before and after `du -sh ~/transom/trash`.
- [ ] **Step 2:** `transom pair --head studio`, then on studio: `ssh studio 'cd /tmp && transom post --zone remote-test <some png>'`. The card appears here.
- [ ] **Step 3:** From studio, `transom ask "ok?" --choice yes <png>`, and answer on the wall.
- [ ] **Step 4 (stop, ask Mike):** a `v0.3.0` tag, a GitHub release, and the formula's `url`/`sha256` bump in `~/src/homebrew-tap`. These publish, so they wait for his go. Never 1.0.
- [ ] **Step 5:** After the merge, start `onto test` in the background as usual.
