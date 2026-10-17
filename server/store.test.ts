import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WallItem } from '@shared/protocol.ts'

/** The store holds its entries in module state and `config` reads the
 *  environment at import, so each test needs the root set and the module
 *  graph dropped before it loads either. */
async function freshStore(root: string) {
  process.env.TRANSOM_ROOT = root
  vi.resetModules()
  return await import('./store.ts')
}

const itemAt = (path: string, over: Partial<WallItem> = {}): WallItem => ({
  id: 'a1',
  url: '/img/a1',
  origUrl: '/orig/a1',
  zone: 'transom',
  name: 'a',
  path,
  bornAt: 1000,
  w: 10,
  h: 10,
  ...over,
})

let root: string
let source: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'transom-store-'))
  source = join(root, 'inbox', 'transom', 'a.png')
  await mkdir(join(root, 'inbox', 'transom'), { recursive: true })
  await writeFile(source, 'png')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('expireNow and undoExpiry', () => {
  it('moves the file to the trash and brings it back with a fresh life', async () => {
    const store = await freshStore(root)
    store.add({ item: itemAt(source), sourcePath: source, cachePath: join(root, 'a.webp') })

    expect(await store.expireNow('a1')).toBe(true)
    expect(existsSync(source)).toBe(false)
    expect(store.snapshot()).toEqual([])

    const back = await store.undoExpiry()
    expect(existsSync(source)).toBe(true)
    expect(store.snapshot().map((i: WallItem) => i.id)).toEqual(['a1'])
    // Restored at its old bornAt it would be past its TTL already and the
    // sweeper would take it again within the second.
    expect(back[0]?.bornAt).toBeGreaterThan(1000)
  })

  it('empties as it undoes, and nothing to undo is empty rather than an error', async () => {
    const store = await freshStore(root)
    expect(await store.undoExpiry()).toEqual([])

    store.add({ item: itemAt(source), sourcePath: source, cachePath: join(root, 'a.webp') })
    await store.expireNow('a1')
    expect(await store.undoExpiry()).toHaveLength(1)
    expect(await store.undoExpiry()).toEqual([])
  })

  /** One file per id in the one zone, fresh enough that the sweeper leaves it. */
  const seedFresh = async (store: Awaited<ReturnType<typeof freshStore>>, ids: string[]) => {
    for (const id of ids) {
      const path = join(root, 'inbox', 'transom', `${id}.png`)
      await writeFile(path, 'png')
      store.add({
        item: itemAt(path, { id, bornAt: Date.now() }),
        sourcePath: path,
        cachePath: join(root, `${id}.webp`),
      })
    }
  }

  it('walks back through the last ten, newest first', async () => {
    const store = await freshStore(root)
    const ids = Array.from({ length: 11 }, (_, i) => `x${i}`)
    await seedFresh(store, ids)
    for (const id of ids) await store.expireNow(id)

    const undone: string[] = []
    for (;;) {
      const back = await store.undoExpiry()
      if (back.length === 0) break
      undone.push(...back.map((i: WallItem) => i.id))
    }
    expect(undone).toEqual(ids.slice(1).reverse())
  })

  it('never lets a TTL running out take the place of a deliberate expiry', async () => {
    const store = await freshStore(root)
    await seedFresh(store, ['mine'])
    await store.expireNow('mine')

    // Born at 1000 against an eight-hour TTL: the first sweep takes it.
    store.add({ item: itemAt(source), sourcePath: source, cachePath: join(root, 'a.webp') })
    const stop = store.startSweeper()
    try {
      await vi.waitFor(() => expect(existsSync(source)).toBe(false), { timeout: 3000 })
    } finally {
      stop()
    }

    expect((await store.undoExpiry()).map((i: WallItem) => i.id)).toEqual(['mine'])
    expect(await store.undoExpiry()).toEqual([])
  })
})

describe('expireZone', () => {
  /** One file per id, so expiry has something real to move to the trash. */
  const seed = async (
    store: Awaited<ReturnType<typeof freshStore>>,
    of: readonly { id: string; zone: string }[],
  ) => {
    for (const { id, zone } of of) {
      const dir = join(root, 'inbox', zone)
      await mkdir(dir, { recursive: true })
      const path = join(dir, `${id}.png`)
      await writeFile(path, 'png')
      store.add({
        item: itemAt(path, { id, zone }),
        sourcePath: path,
        cachePath: join(root, `${id}.webp`),
      })
    }
  }

  it('takes every artifact in the zone and leaves its neighbours alone', async () => {
    const store = await freshStore(root)
    await seed(store, [
      { id: 'a1', zone: 'alpha' },
      { id: 'a2', zone: 'alpha' },
      { id: 'b1', zone: 'beta' },
    ])
    const gone = await store.expireZone('alpha')
    expect(gone.sort()).toEqual(['a1', 'a2'])
    expect(store.snapshot().map((i: WallItem) => i.id)).toEqual(['b1'])
  })

  it('is one undo step however many it took', async () => {
    const store = await freshStore(root)
    await seed(store, [
      { id: 'a1', zone: 'alpha' },
      { id: 'a2', zone: 'alpha' },
    ])
    await store.expireZone('alpha')
    expect(store.snapshot()).toHaveLength(0)
    const back = await store.undoExpiry()
    expect(back.map((i: WallItem) => i.id).sort()).toEqual(['a1', 'a2'])
    expect(await store.undoExpiry()).toEqual([])
  })

  it('says nothing went when the zone is not there', async () => {
    const store = await freshStore(root)
    expect(await store.expireZone('nowhere')).toEqual([])
  })
})

describe('questions', () => {
  const asking = (over: Partial<WallItem> = {}) =>
    itemAt(source, {
      question: 'which crop?',
      choices: ['left', 'right'],
      attention: { level: 'look', holdMs: null },
      ...over,
    })
  const answerFile = () => join(root, 'answers', 'a.png')
  const sidecar = async () => JSON.parse(await readFile(`${source}.transom.json`, 'utf8'))

  beforeEach(async () => {
    await writeFile(
      `${source}.transom.json`,
      JSON.stringify({ question: 'which crop?', choices: ['left', 'right'], attention: 'look', caption: 'a' }),
    )
  })

  it('writes the answer where the asker waits, and keeps the question on the card with its reply', async () => {
    const store = await freshStore(root)
    store.add({ item: asking(), sourcePath: source, cachePath: join(root, 'a.webp') })

    expect(await store.answer('a1', 'answered', 'left')).toBe(true)
    expect(await readFile(answerFile(), 'utf8')).toBe('answered\n\nleft')
    const item = store.snapshot()[0]
    expect(item?.question).toBe('which crop?')
    expect(item?.choices).toEqual(['left', 'right'])
    expect(item?.attention).toBeUndefined()
    expect(item?.reply).toMatchObject({ status: 'answered', text: 'left' })
    const disk = await sidecar()
    expect(disk.attention).toBeUndefined()
    expect(disk).toMatchObject({ question: 'which crop?', reply: 'left', closed: 'answered' })
    expect(Date.parse(disk.closedAt)).toBe(item?.reply?.at)
  })

  it('answers once, so a second click cannot overwrite what the asker already read', async () => {
    const store = await freshStore(root)
    store.add({ item: asking(), sourcePath: source, cachePath: join(root, 'a.webp') })
    await store.answer('a1', 'answered', 'left')
    expect(await store.answer('a1', 'answered', 'right')).toBe(false)
    expect(await readFile(answerFile(), 'utf8')).toBe('answered\n\nleft')
  })

  it('ends the wait as dismissed only when dismissing is meant to close the question', async () => {
    const store = await freshStore(root)
    store.add({ item: asking(), sourcePath: source, cachePath: join(root, 'a.webp') })
    expect(await store.dismiss('a1')).toBe(false)
    expect(existsSync(answerFile())).toBe(false)
    expect(store.snapshot()[0]?.reply).toBeUndefined()
    expect(await store.dismiss('a1', true)).toBe(true)
    expect(await readFile(answerFile(), 'utf8')).toBe('dismissed\n\n')
    expect(store.snapshot()[0]?.reply?.status).toBe('dismissed')
  })

  it('ends the wait as expired when the card is expired by hand', async () => {
    const store = await freshStore(root)
    store.add({ item: asking(), sourcePath: source, cachePath: join(root, 'a.webp') })
    await store.expireNow('a1')
    expect(await readFile(answerFile(), 'utf8')).toBe('expired\n\n')
    const [back] = await store.undoExpiry()
    expect(back?.reply?.status).toBe('expired')
  })

  it('is never taken by its TTL while it is still open', async () => {
    const store = await freshStore(root)
    store.add({ item: asking(), sourcePath: source, cachePath: join(root, 'a.webp') })
    const stop = store.startSweeper()
    await new Promise((r) => setTimeout(r, 1200))
    stop()
    expect(existsSync(source)).toBe(true)
  })

  it('lives out a whole TTL from its answer, not from when it was asked', async () => {
    const store = await freshStore(root)
    // Born at 1000, long past an eight-hour TTL: only the answer keeps it.
    store.add({ item: asking(), sourcePath: source, cachePath: join(root, 'a.webp') })
    await store.answer('a1', 'answered', 'left')
    const stop = store.startSweeper()
    await new Promise((r) => setTimeout(r, 1200))
    stop()
    expect(existsSync(source)).toBe(true)
  })
})

describe("a zone's own lifetime", () => {
  it('takes what is already hanging in the zone, not just what lands next', async () => {
    process.env.TRANSOM_TTL = '8h'
    const store = await freshStore(root)
    const zones = await import('./zones.ts')
    await zones.load()
    await zones.set('transom', { lifetime: 60_000 })
    // Two minutes old, inside the wall's eight hours and past the zone's minute.
    store.add({
      item: itemAt(source, { bornAt: Date.now() - 120_000 }),
      sourcePath: source,
      cachePath: join(root, 'a.webp'),
    })
    const stop = store.startSweeper()
    try {
      await vi.waitFor(() => expect(existsSync(source)).toBe(false), { timeout: 3000 })
    } finally {
      stop()
      delete process.env.TRANSOM_TTL
    }
  })

  it('loses to the artifact\'s own TTL, which is the narrower claim', async () => {
    process.env.TRANSOM_TTL = '1m'
    const store = await freshStore(root)
    const zones = await import('./zones.ts')
    await zones.load()
    await zones.set('transom', { lifetime: 60_000 })
    store.add({
      item: itemAt(source, { bornAt: Date.now() - 120_000, ttlMs: 86_400_000 }),
      sourcePath: source,
      cachePath: join(root, 'a.webp'),
    })
    const stop = store.startSweeper()
    await new Promise((r) => setTimeout(r, 1200))
    stop()
    delete process.env.TRANSOM_TTL
    expect(existsSync(source)).toBe(true)
  })

  it.each(['indefinite', 'eternal'] as const)(
    'holds an artifact off the clock when the zone says %s',
    async (hold) => {
      process.env.TRANSOM_TTL = '1m'
      const store = await freshStore(root)
      const zones = await import('./zones.ts')
      await zones.load()
      await zones.set('transom', { lifetime: hold })
      // A year old, against a wall lifetime of one minute.
      store.add({
        item: itemAt(source, { bornAt: Date.now() - 365 * 86_400_000 }),
        sourcePath: source,
        cachePath: join(root, 'a.webp'),
      })
      const stop = store.startSweeper()
      await new Promise((r) => setTimeout(r, 1200))
      stop()
      delete process.env.TRANSOM_TTL
      expect(existsSync(source)).toBe(true)
    },
  )
})

describe('taking a zone in bulk', () => {
  it('passes over an eternal zone, which is what separates it from indefinite', async () => {
    const store = await freshStore(root)
    const zones = await import('./zones.ts')
    await zones.load()
    await zones.set('transom', { lifetime: 'eternal' })
    store.add({
      item: itemAt(source, { bornAt: Date.now() }),
      sourcePath: source,
      cachePath: join(root, 'a.webp'),
    })
    expect(await store.expireZone('transom')).toEqual([])
    expect(existsSync(source)).toBe(true)
  })

  it('takes an indefinite zone, which is off the clock and nothing more', async () => {
    const store = await freshStore(root)
    const zones = await import('./zones.ts')
    await zones.load()
    await zones.set('transom', { lifetime: 'indefinite' })
    store.add({
      item: itemAt(source, { bornAt: Date.now() }),
      sourcePath: source,
      cachePath: join(root, 'a.webp'),
    })
    expect(await store.expireZone('transom')).toHaveLength(1)
    expect(existsSync(source)).toBe(false)
  })
})

describe('the wall lifetime as the panel sets it', () => {
  it('sweeps against the live setting rather than what the daemon started with', async () => {
    process.env.TRANSOM_TTL = '8h'
    const store = await freshStore(root)
    const settings = await import('./settings.ts')
    await settings.load()
    await settings.setTtl(60_000)
    // Two minutes old against the minute it was just given.
    store.add({
      item: itemAt(source, { bornAt: Date.now() - 120_000 }),
      sourcePath: source,
      cachePath: join(root, 'a.webp'),
    })
    const stop = store.startSweeper()
    try {
      await vi.waitFor(() => expect(existsSync(source)).toBe(false), { timeout: 3000 })
    } finally {
      stop()
      delete process.env.TRANSOM_TTL
    }
  })
})

describe('groups', () => {
  const card = (over: Partial<WallItem> = {}) => {
    const { takes: _takes, kind: _kind, ...rest } = itemAt(source, { id: 'run1', ...over })
    return rest
  }
  const takeAt = (id: string, at: number, path: string) => ({
    id,
    url: `/img/${id}`,
    origUrl: `/orig/${id}`,
    name: id,
    path,
    at,
    w: 20,
    h: 10,
    question: 'how does this read?',
    choices: ['worse', 'better'],
  })

  /** A take's own file, since each one is answered and trashed separately. */
  async function fileFor(id: string) {
    const path = join(root, 'inbox', 'transom', `${id}.png`)
    await writeFile(path, 'png')
    // A take always has one: `transom` writes the sidecar that carries its question.
    await writeFile(`${path}.transom.json`, JSON.stringify({ group: 'sweep' }))
    return path
  }

  it('opens one card for the first take and appends the rest to it', async () => {
    const store = await freshStore(root)
    const one = await fileFor('t1')
    const two = await fileFor('t2')

    const first = store.addTake(card(), takeAt('t1', 1000, one), { sourcePath: one, cachePath: one }, { of: 2 })
    const second = store.addTake(card(), takeAt('t2', 1001, two), { sourcePath: two, cachePath: two }, {})

    expect(first?.opened).toBe(true)
    expect(second?.opened).toBe(false)
    expect(store.snapshot()).toHaveLength(1)
    expect(store.snapshot()[0]?.takes?.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(store.snapshot()[0]?.group?.of).toBe(2)
  })

  it('holds takes in arrival order however the daemon re-adopted them', async () => {
    const store = await freshStore(root)
    const one = await fileFor('t1')
    const two = await fileFor('t2')
    store.addTake(card(), takeAt('t2', 2000, two), { sourcePath: two, cachePath: two }, {})
    store.addTake(card(), takeAt('t1', 1000, one), { sourcePath: one, cachePath: one }, {})
    expect(store.snapshot()[0]?.takes?.map((t) => t.id)).toEqual(['t1', 't2'])
  })

  it('draws the first unanswered take, and moves on as each is answered', async () => {
    const store = await freshStore(root)
    const one = await fileFor('t1')
    const two = await fileFor('t2')
    store.addTake(card(), takeAt('t1', 1000, one), { sourcePath: one, cachePath: one }, { of: 2 })
    store.addTake(card(), takeAt('t2', 1001, two), { sourcePath: two, cachePath: two }, {})

    expect(store.snapshot()[0]?.url).toBe('/img/t1')
    await store.answer('run1', 'answered', 'too dark', 'worse', 't1')
    expect(store.snapshot()[0]?.url).toBe('/img/t2')
    // And the card serves that take's files, so `/orig/<card>` is the poster.
    expect(store.resolveOriginal('run1')).toBe(two)
  })

  it('answers a take with its chip and its comment, where the asker waits', async () => {
    const store = await freshStore(root)
    const one = await fileFor('t1')
    store.addTake(card(), takeAt('t1', 1000, one), { sourcePath: one, cachePath: one }, {})

    expect(await store.answer('run1', 'answered', 'too dark', 'worse', 't1')).toBe(true)
    expect(await readFile(join(root, 'answers', 't1.png'), 'utf8')).toBe('answered\nworse\ntoo dark')
    expect(store.replyOf('run1', 't1')).toMatchObject({ choice: 'worse', text: 'too dark' })
    // And the sidecar carries it, so a restart shows the reply rather than asking again.
    expect(JSON.parse(await readFile(`${one}.transom.json`, 'utf8')).choice).toBe('worse')
  })

  it('answers each take once, so a second click cannot overwrite what was read', async () => {
    const store = await freshStore(root)
    const one = await fileFor('t1')
    store.addTake(card(), takeAt('t1', 1000, one), { sourcePath: one, cachePath: one }, {})
    expect(await store.answer('run1', 'answered', '', 'worse', 't1')).toBe(true)
    expect(await store.answer('run1', 'answered', '', 'better', 't1')).toBe(false)
    expect(store.replyOf('run1', 't1')?.choice).toBe('worse')
  })

  it('dismisses one take without touching the others', async () => {
    const store = await freshStore(root)
    const one = await fileFor('t1')
    const two = await fileFor('t2')
    store.addTake(card(), takeAt('t1', 1000, one), { sourcePath: one, cachePath: one }, {})
    store.addTake(card(), takeAt('t2', 1001, two), { sourcePath: two, cachePath: two }, {})

    await store.answer('run1', 'dismissed', '', undefined, 't1')
    expect(store.replyOf('run1', 't1')?.status).toBe('dismissed')
    expect(store.replyOf('run1', 't2')).toBeUndefined()
    expect(store.snapshot()[0]?.url).toBe('/img/t2')
  })

  it('closes every open take when the card itself is dismissed', async () => {
    const store = await freshStore(root)
    const one = await fileFor('t1')
    const two = await fileFor('t2')
    store.addTake(card({ attention: { level: 'look', holdMs: null } }), takeAt('t1', 1000, one), { sourcePath: one, cachePath: one }, {})
    store.addTake(card(), takeAt('t2', 1001, two), { sourcePath: two, cachePath: two }, {})

    expect(await store.dismiss('run1', true)).toBe(true)
    expect(store.replyOf('run1', 't1')?.status).toBe('dismissed')
    expect(store.replyOf('run1', 't2')?.status).toBe('dismissed')
    expect(store.snapshot()[0]?.attention).toBeUndefined()
  })

  it('takes the whole carousel to the trash, and brings it all back', async () => {
    const store = await freshStore(root)
    const one = await fileFor('t1')
    const two = await fileFor('t2')
    store.addTake(card(), takeAt('t1', 1000, one), { sourcePath: one, cachePath: one }, {})
    store.addTake(card(), takeAt('t2', 1001, two), { sourcePath: two, cachePath: two }, {})

    expect(await store.expireNow('run1')).toBe(true)
    expect(existsSync(one)).toBe(false)
    expect(existsSync(two)).toBe(false)
    // Each take under its own name: one name for both would lose a file.
    const [back] = await store.undoExpiry()
    expect(back?.takes).toHaveLength(2)
    expect(existsSync(one)).toBe(true)
    expect(existsSync(two)).toBe(true)
    expect(store.pathOf('t2')).toBe(two)
  })

  it('serves each take by its own id, so the carousel can page them', async () => {
    const store = await freshStore(root)
    const one = await fileFor('t1')
    store.addTake(card(), takeAt('t1', 1000, one), { sourcePath: one, cachePath: `${one}.webp` }, {})
    expect(store.resolveCache('t1')).toBe(`${one}.webp`)
    expect(store.takeAt('t1')?.item.id).toBe('run1')
    expect(store.takeAt('nope')).toBe(null)
  })

  it('refuses a take past the cap, so a card cannot grow without bound', async () => {
    const store = await freshStore(root)
    const { MAX_TAKES } = await import('@shared/groups.ts')
    for (let n = 0; n < MAX_TAKES; n++) {
      const path = await fileFor(`t${n}`)
      expect(store.addTake(card(), takeAt(`t${n}`, 1000 + n, path), { sourcePath: path, cachePath: path }, {})).not.toBe(null)
    }
    const over = await fileFor('over')
    expect(store.addTake(card(), takeAt('over', 9999, over), { sourcePath: over, cachePath: over }, {})).toBe(null)
  })

  it('reports every take as held, so the sweep re-offers none of them', async () => {
    const store = await freshStore(root)
    const one = await fileFor('t1')
    const two = await fileFor('t2')
    store.addTake(card(), takeAt('t1', 1000, one), { sourcePath: one, cachePath: one }, {})
    store.addTake(card(), takeAt('t2', 1001, two), { sourcePath: two, cachePath: two }, {})
    expect(store.has(one)).toBe(true)
    expect(store.has(two)).toBe(true)
    expect(store.has(join(root, 'inbox', 'transom', 'other.png'))).toBe(false)
  })
})
