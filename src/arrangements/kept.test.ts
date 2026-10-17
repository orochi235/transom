import { describe, expect, it } from 'vitest'
import { createInbox } from '@/arrangements/inbox.ts'
import { IN_KEPT_BAND, withKeptBand } from '@/arrangements/kept.ts'
import { createStack } from '@/arrangements/stack.ts'
import type { Arrangement } from '@/arrangements/types.ts'
import { defaultParams } from '@/params.ts'

const container = { w: 16 / 9, h: 1 }
const item = (id: string, zone: string, keptAt?: number) => ({
  id,
  zone,
  age01: 0.3,
  emphasis: 0,
  excluded: false,
  aspect: 1,
  ...(keptAt === undefined ? {} : { keptAt }),
})

const run = (a: Arrangement, items: ReturnType<typeof item>[], now = 0) =>
  a.strategy.layout({ items, container, state: undefined, options: { now } })

const bandTop = container.h * (1 - defaultParams.kept.height)

describe.each([
  ['stack', () => createStack()],
  ['inbox', () => createInbox()],
])('the kept band under %s', (_name, make) => {
  it('takes no room while nothing is kept', () => {
    const items = [item('a', 'z'), item('b', 'y')]
    expect(run(withKeptBand(make(), defaultParams), items).placements).toEqual(
      run(make(), items).placements,
    )
  })

  it('moves a kept card into the band and lays the rest out above it', () => {
    const out = run(withKeptBand(make(), defaultParams), [item('a', 'z'), item('b', 'z'), item('k', 'z', 5)])
    const kept = out.placements.get('k')!
    expect(kept.y).toBeGreaterThanOrEqual(bandTop)
    expect(kept.y + kept.h).toBeLessThanOrEqual(container.h)
    expect(out.channels?.get('k')?.[IN_KEPT_BAND]).toBe(1)
    for (const id of ['a', 'b']) {
      expect(out.channels?.get(id)?.[IN_KEPT_BAND]).toBeUndefined()
      // The flowing set's own cells stop at the band, though a pile's deep
      // ranks may lean past them.
      expect(out.placements.get(id)!.y).toBeLessThan(bandTop)
    }
  })
})

describe('the kept band', () => {
  const band = () => withKeptBand(createStack(), defaultParams)

  it('lines kept cards up longest-kept first, left to right, without overlapping', () => {
    const out = run(band(), [item('late', 'z', 30), item('early', 'y', 10), item('mid', 'z', 20)])
    const xs = ['early', 'mid', 'late'].map((id) => out.placements.get(id)!)
    expect(xs[0]!.x + xs[0]!.w).toBeLessThanOrEqual(xs[1]!.x)
    expect(xs[1]!.x + xs[1]!.w).toBeLessThanOrEqual(xs[2]!.x)
  })

  it('shrinks the cards to fit the width when the band is crowded', () => {
    const many = Array.from({ length: 12 }, (_, i) => item(`k${i}`, 'z', i))
    const out = run(band(), many)
    const rects = many.map((it) => out.placements.get(it.id)!)
    expect(rects[0]!.x).toBeGreaterThanOrEqual(0)
    expect(rects[11]!.x + rects[11]!.w).toBeLessThanOrEqual(container.w)
  })

  it('slides a card just kept down out of the place it stood', () => {
    const a = band()
    const before = run(a, [item('a', 'z')], 0).placements.get('a')!
    const start = run(a, [item('a', 'z', 1)], 1).placements.get('a')!
    expect(start.y).toBeCloseTo(before.y)
    const settled = run(a, [item('a', 'z', 1)], 1 + 10 * defaultParams.inbox.moveMs).placements.get('a')!
    expect(settled.y).toBeGreaterThanOrEqual(bandTop)
  })
})
