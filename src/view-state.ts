import { hashOfPath } from '@shared/viewHash.ts'

/**
 * Where the view is, as a path from the wall down. `[]` is the wall itself,
 * `['weasel']` a pile with focus, `['weasel', 'img-1']` a card.
 *
 * A path rather than a case per level, because the navigation has to hold for
 * however many rungs the hierarchy grows. What a rung *means* — which box the
 * camera frames, whether it is drawn in the scene or raised as an overlay —
 * stays with the renderer, which is where a new rung's geometry has to be
 * taught anyway.
 */
export type ViewState = {
  path: readonly string[]
  /** Where the view was before a jump that skipped a rung — the wall when a
   *  badge opens a card straight from it. `out` returns here rather than to
   *  the rung above, so leaving a card puts you back where you were. */
  from?: readonly string[]
}

export type ViewAction =
  /** Climb one rung. At the wall there is nowhere further out. */
  | { type: 'out' }
  /** Land on a path outright. Descending is this too: `stepToward` owns the
   *  rule that a gesture moves one rung, so the reducer need not. */
  | { type: 'to'; path: readonly string[] }
  /** The daemon owns item lifetime, so a zone — or the card open in it — can
   *  vanish under the camera. */
  | { type: 'prune'; live: readonly string[]; cards?: readonly string[] }

export const WALL: ViewState = { path: [] }

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => b[i] === v)

export function reduceView(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case 'out':
      if (state.from) return { path: state.from }
      return state.path.length === 0 ? state : { path: state.path.slice(0, -1) }
    case 'to': {
      if (same(state.path, action.path)) return state
      // A step down the rung below is the ordinary descent. Any other move
      // deeper is a jump — past a rung, or into another pile's card — and
      // remembers its start; a step sideways at the same depth, paging the
      // lightbox, keeps it; a climb forgets it.
      const steps =
        action.path.length === state.path.length + 1 && same(action.path.slice(0, -1), state.path)
      if (steps) return { path: action.path }
      if (action.path.length > state.path.length) return { path: action.path, from: state.path }
      if (state.from && action.path.length === state.path.length) return { path: action.path, from: state.from }
      return { path: action.path }
    }
    case 'prune': {
      const [zone, card] = state.path
      if (zone === undefined) return state
      if (!action.live.includes(zone)) return WALL
      if (card !== undefined && action.cards && !action.cards.includes(card)) {
        return state.from ? { path: state.from } : { path: [zone] }
      }
      return state
    }
  }
}

/** How many rungs down the view sits. The renderer's one question of the path. */
export const depthOf = (state: ViewState): number => state.path.length

/** The two rungs this wall has today, named here and nowhere else, so growing
 *  the hierarchy is one file's problem. */
export const zoneOf = (state: ViewState): string | null => state.path[0] ?? null
export const cardOf = (state: ViewState): string | null => state.path[1] ?? null

/**
 * One rung in, the inverse of `out`: the wall goes to the pile the cursor is
 * on, and a pile to its front card. Null where there is nothing to go into —
 * the wall with no cursor, a pile with no cards, or a card already.
 */
export function descend(
  path: readonly string[],
  cursor: string | null,
  frontOf: (zone: string) => string | undefined,
): readonly string[] | null {
  const [zone, card] = path
  if (card !== undefined) return null
  if (zone === undefined) return cursor ? [cursor] : null
  const front = frontOf(zone)
  return front ? [zone, front] : null
}

/** The view as a URL fragment — `#/weasel/img-1`, or empty for the wall. */
export function hashOfView(state: ViewState): string {
  return hashOfPath(state.path)
}

/** The inverse of `hashOfView`. Anything it cannot read is the wall, and only
 *  the rungs `zoneOf` and `cardOf` name are kept. */
export function viewFromHash(hash: string): ViewState {
  const body = hash.replace(/^#\/?/, '')
  if (!body) return WALL
  try {
    return { path: body.split('/').filter(Boolean).slice(0, 2).map(decodeURIComponent) }
  } catch {
    return WALL
  }
}
