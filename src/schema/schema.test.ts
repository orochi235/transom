import { describe, expect, it } from 'vitest'
import { isPrefLeaf, prefLeafAt, prefLeaves, type PrefAlias, type PrefGroup, type PrefNumber } from '@weasel-js/prefs'
import { defaultParams } from '@/params.ts'
import { defaultsOf } from '@/schema/defaults.ts'
import { PARAMS } from '@/schema/params.ts'
import { SHEET } from '@/schema/sheet.ts'

/** Every param a page points at, in the order it lists them. */
function pointed(group: PrefGroup): string[] {
  return Object.values(group.children).flatMap((child) => {
    if (!isPrefLeaf(child)) return pointed(child)
    return child.kind === 'alias' ? [(child as PrefAlias).of] : []
  })
}

describe('defaultsOf', () => {
  it('reads a group keyed by index as a list', () => {
    const group: PrefGroup = {
      name: '',
      children: {
        rungs: {
          name: '',
          children: {
            '0': { kind: 'number', name: '', description: '', default: 4 },
            '1': { kind: 'number', name: '', description: '', default: 9 },
          },
        },
      },
    }
    expect(defaultsOf(group)).toEqual({ rungs: [4, 9] })
  })

  it('gives the params their lists', () => {
    expect(Array.isArray(defaultParams.camera.margins)).toBe(true)
    expect(defaultParams.lod.tiers.map((tier) => tier.edge)).toEqual([512, 128, 32, 0])
  })
})

describe('PARAMS', () => {
  it('holds every slider default inside its own range', () => {
    const out = [...prefLeaves(PARAMS)].filter(([, leaf]) => {
      if (leaf.kind !== 'number') return false
      const { min, max, default: value } = leaf as PrefNumber
      return value !== undefined && ((min !== undefined && value < min) || (max !== undefined && value > max))
    })
    expect(out.map(([path]) => path)).toEqual([])
  })
})

describe('SHEET', () => {
  const placed = SHEET.flatMap((page) => pointed(page.root))

  it('points only at params the schema holds', () => {
    expect(placed.filter((path) => prefLeafAt(PARAMS, path) === undefined)).toEqual([])
  })

  it('puts every param it draws on one page and no param on two', () => {
    const drawn = [...prefLeaves(PARAMS)].filter(([, leaf]) => !leaf.hidden).map(([path]) => path)
    expect(drawn.filter((path) => !placed.includes(path))).toEqual([])
    expect(placed.filter((path, i) => placed.indexOf(path) !== i)).toEqual([])
  })
})
