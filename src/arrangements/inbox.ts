import type { LayoutItem, LayoutResult, Rect } from 'windease'
import { createGlides } from './glide.ts'
import { ramp } from './slots.ts'
import { defaultParams, type StackParams } from '@/params.ts'
import type { Arrangement, TransomChannels, Size } from './types.ts'

type InboxItem = LayoutItem & { age01: number; emphasis?: number; excluded?: boolean }

type Cfg = StackParams['inbox']

/** Targets for the ids handed in, newest first. Ids with no room are unplaced. */
type Placed = { rects: Map<string, Rect>; unplaced: string[] }

const square = (x: number, y: number, side: number): Rect => ({ x, y, z: 0, w: side, h: side })

/** How many squares of `side` fit along `span` with `gap` between them. */
const fitting = (span: number, side: number, gap: number) =>
  Math.max(0, Math.floor((span + gap) / (side + gap)))

/**
 * Equal square cells in reading order. The side is the largest that fits every
 * id, capped at `maxSide`; below `floor` it holds at `floor` and the oldest go.
 */
export function gridLayout(ids: readonly string[], box: Size, cfg: Cfg): Placed {
  const n = ids.length
  if (n === 0) return { rects: new Map(), unplaced: [] }
  let side = 0
  let cols = 1
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c)
    const s = Math.min((box.w - cfg.gap * (c - 1)) / c, (box.h - cfg.gap * (r - 1)) / r)
    if (s > side) {
      side = s
      cols = c
    }
  }
  side = Math.min(side, cfg.maxSide)
  if (side < cfg.floor) {
    side = cfg.floor
    cols = Math.max(1, fitting(box.w, side, cfg.gap))
  }
  const capacity = cols * Math.max(1, fitting(box.h, side, cfg.gap))
  const shown = ids.slice(0, capacity)
  const rows = Math.ceil(shown.length / cols)
  const usedCols = Math.min(cols, shown.length)
  const x0 = (box.w - (usedCols * (side + cfg.gap) - cfg.gap)) / 2
  const y0 = (box.h - (rows * (side + cfg.gap) - cfg.gap)) / 2

  const rects = new Map<string, Rect>()
  shown.forEach((id, i) => {
    rects.set(id, square(x0 + (i % cols) * (side + cfg.gap), y0 + Math.floor(i / cols) * (side + cfg.gap), side))
  })
  return { rects, unplaced: ids.slice(capacity) }
}

/** Unit cells each id spans, newest first: `big` at three, `mid` at two, the rest at one. */
const spanOf = (i: number, cfg: Cfg) => (i < cfg.big ? 3 : i < cfg.big + cfg.mid ? 2 : 1)

/** First-fit square packing on a `cols` × `rows` unit grid, in order. Stops at
 *  the first id with no room, so what is cut is always the oldest. */
function pack(spans: readonly number[], cols: number, rows: number) {
  const taken = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false))
  const free = (c: number, r: number, k: number) => {
    if (c + k > cols || r + k > rows) return false
    for (let y = r; y < r + k; y++) for (let x = c; x < c + k; x++) if (taken[y]![x]) return false
    return true
  }
  const at: { c: number; r: number; k: number }[] = []
  for (const k of spans) {
    let spot: { c: number; r: number } | null = null
    for (let r = 0; r < rows && !spot; r++) for (let c = 0; c < cols && !spot; c++) if (free(c, r, k)) spot = { c, r }
    if (!spot) break
    for (let y = spot.r; y < spot.r + k; y++) for (let x = spot.c; x < spot.c + k; x++) taken[y]![x] = true
    at.push({ ...spot, k })
  }
  return at
}

/**
 * The newest take the biggest cells: size is age, in three steps. The unit
 * shrinks until every id packs, capped so the biggest card stays under
 * `maxSide`; at `floor` it stops shrinking and the oldest go.
 */
export function mosaicLayout(ids: readonly string[], box: Size, cfg: Cfg): Placed {
  const n = ids.length
  if (n === 0) return { rects: new Map(), unplaced: [] }
  const spans = ids.map((_, i) => spanOf(i, cfg))
  const biggest = spans[0] ?? 1
  const sideOf = (unit: number, k: number) => k * unit + (k - 1) * cfg.gap

  let unit = Math.min(
    Math.sqrt((box.w * box.h) / spans.reduce((sum, k) => sum + k * k, 0)),
    (cfg.maxSide - (biggest - 1) * cfg.gap) / biggest,
  )
  let at: ReturnType<typeof pack> = []
  let cols = 1
  for (;;) {
    const u = Math.max(unit, cfg.floor)
    cols = fitting(box.w, u, cfg.gap)
    at = pack(spans, cols, fitting(box.h, u, cfg.gap))
    if (at.length === n || u <= cfg.floor) {
      unit = u
      break
    }
    unit *= 0.97
  }

  let w = 0
  let h = 0
  for (const { c, r, k } of at) {
    w = Math.max(w, (c + k) * (unit + cfg.gap) - cfg.gap)
    h = Math.max(h, (r + k) * (unit + cfg.gap) - cfg.gap)
  }
  const x0 = (box.w - w) / 2
  const y0 = (box.h - h) / 2
  const rects = new Map<string, Rect>()
  at.forEach(({ c, r, k }, i) => {
    rects.set(ids[i]!, square(x0 + c * (unit + cfg.gap), y0 + r * (unit + cfg.gap), sideOf(unit, k)))
  })
  return { rects, unplaced: ids.slice(at.length) }
}

/**
 * Distance from the left edge is age: a card enters at the left and crosses to
 * the right over its life. Lanes are dealt round-robin in arrival order, and a
 * card never overlaps the newer one ahead of it in its lane — it is pushed
 * right instead, and one pushed off the far edge leaves the wall.
 */
export function riverLayout(items: readonly InboxItem[], box: Size, cfg: Cfg, lane: (id: string) => number): Placed {
  const lanes = Math.max(1, Math.round(cfg.lanes))
  const side = Math.max(cfg.floor, Math.min(cfg.maxSide, (box.h - cfg.gap * (lanes - 1)) / lanes))
  const y0 = (box.h - (lanes * (side + cfg.gap) - cfg.gap)) / 2
  const travel = Math.max(0, box.w - side)
  const edge = new Array<number>(lanes).fill(Number.NEGATIVE_INFINITY)

  const rects = new Map<string, Rect>()
  const unplaced: string[] = []
  for (const it of items) {
    const l = lane(it.id) % lanes
    const x = Math.max(it.age01 * travel, edge[l]!)
    if (x > travel + 1e-9) {
      unplaced.push(it.id)
      continue
    }
    edge[l] = x + side + cfg.gap
    rects.set(it.id, square(x, y0 + l * (side + cfg.gap), side))
  }
  return { rects, unplaced }
}

/** The texture tier a card of this world side needs to stay sharp. */
export const edgeFor = (side: number) => (side >= 0.2 ? 512 : side >= 0.05 ? 128 : 32)

/**
 * Every artifact at once, zones ignored, newest first — "what has arrived",
 * where `stack` answers "what is each project doing". Flat: zones are not a
 * level of this wall, so the renderer draws no zone chrome over it.
 */
export function createInbox(params: StackParams = defaultParams): Arrangement {
  const cfg = params.inbox
  const glides = createGlides()
  const lanes = new Map<string, number>()
  let nextLane = 0

  return {
    name: 'inbox',
    flat: true,
    camera: {
      projection: params.camera.projection,
      fovDeg: params.camera.fovDeg,
      z:
        params.camera.projection === 'orthographic'
          ? params.camera.standoff
          : 0.5 / Math.tan((params.camera.fovDeg * Math.PI) / 360),
    },
    strategy: {
      name: 'transom-inbox',
      layout({ items, container, options }): LayoutResult {
        const now = typeof options.now === 'number' ? options.now : Date.now()
        // Kept first, newest first: an excluded artifact goes to the back of
        // the line, which is what lets the band's range close the gap it cuts.
        const all = [...(items as InboxItem[])].sort(
          (a, b) => Number(!!a.excluded) - Number(!!b.excluded) || a.age01 - b.age01,
        )
        const present = new Set(all.map((it) => it.id))
        for (const id of lanes.keys()) if (!present.has(id)) lanes.delete(id)
        // Dealt in arrival order and held, so a card never changes lane and a
        // wall loaded cold deals the same lanes a live one would have.
        for (const it of [...all].reverse()) if (!lanes.has(it.id)) lanes.set(it.id, nextLane++)

        const ids = all.map((it) => it.id)
        const { rects, unplaced } =
          cfg.mode === 'river'
            ? riverLayout(all, container, cfg, (id) => lanes.get(id) ?? 0)
            : cfg.mode === 'mosaic'
              ? mosaicLayout(ids, container, cfg)
              : gridLayout(ids, container, cfg)
        glides.keep(rects)

        const placements = new Map<string, Rect>()
        const channels = new Map<string, Record<string, number>>()
        for (const it of all) {
          const target = rects.get(it.id)
          if (!target) continue
          // River motion is already continuous in age; gliding it would lag.
          const rect = cfg.mode === 'river' ? target : glides.at(it.id, target, now, cfg.moveMs)
          placements.set(it.id, rect)
          channels.set(it.id, {
            z: 0,
            opacity: 1 - ramp(it.age01, params.fade.from, params.fade.to),
            rotX: 0,
            rotY: 0,
            rotZ: 0,
            lod: edgeFor(target.w),
            emphasis: it.emphasis ?? 0,
          } satisfies TransomChannels)
        }
        return { placements, affordances: [], channels, ...(unplaced.length ? { unplaced } : {}) }
      },
    },
  }
}
