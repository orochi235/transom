import { describe, expect, it } from 'vitest'
import type { Rect } from 'windease'
import { cardHit, zoneAt } from '@/nav/pick.ts'

const box = (x: number, y: number, w: number, h: number): Rect => ({ x, y, z: 0, w, h })

describe('zoneAt', () => {
  const cells = new Map([
    ['alpha', box(0, 0, 1, 1)],
    ['beta', box(1.2, 0, 1, 1)],
  ])

  it('names the cell the point falls in', () => {
    expect(zoneAt({ x: 0.5, y: 0.5 }, cells)).toBe('alpha')
    expect(zoneAt({ x: 1.5, y: 0.5 }, cells)).toBe('beta')
  })

  it('names nothing in the gap between cells', () => {
    expect(zoneAt({ x: 1.1, y: 0.5 }, cells)).toBeNull()
  })

  it('names nothing outside the wall', () => {
    expect(zoneAt({ x: -1, y: 0.5 }, cells)).toBeNull()
    expect(zoneAt({ x: 0.5, y: 4 }, cells)).toBeNull()
  })

  it('claims its top-left edge and yields its bottom-right, so touching cells do not both answer', () => {
    const touching = new Map([
      ['left', box(0, 0, 1, 1)],
      ['right', box(1, 0, 1, 1)],
    ])
    expect(zoneAt({ x: 1, y: 0.5 }, touching)).toBe('right')
  })

  it('gives an overlap to the tighter cell, so a pile that outgrew its box does not swallow its neighbour', () => {
    const overlapping = new Map([
      ['sprawling', box(0, 0, 3, 3)],
      ['tight', box(1, 1, 0.5, 0.5)],
    ])
    expect(zoneAt({ x: 1.2, y: 1.2 }, overlapping)).toBe('tight')
  })

  it('names nothing on an empty wall', () => {
    expect(zoneAt({ x: 0, y: 0 }, new Map())).toBeNull()
  })
})

describe('cardHit', () => {
  const zoneOf = (id: string) => id.split(':')[0]

  it('takes the nearest card when the pointer is over no base', () => {
    expect(cardHit(['bricks:deep', 'perch:front'], zoneOf, null)).toBe('bricks:deep')
  })

  it("passes over a neighbour's deep card for the card of the base under the pointer", () => {
    expect(cardHit(['bricks:deep', 'perch:front'], zoneOf, 'perch')).toBe('perch:front')
  })

  it("hits nothing over a base whose own pile is not under the pointer, rather than the neighbour's tail", () => {
    expect(cardHit(['bricks:deep'], zoneOf, 'perch')).toBeUndefined()
  })
})
