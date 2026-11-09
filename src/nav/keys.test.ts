import { describe, expect, it } from 'vitest'
import {
  deletes,
  directionFor,
  isForAControl,
  opensIn,
  sortFor,
  togglesList,
  cyclesFollow,
} from '@/nav/keys.ts'

describe('directionFor', () => {
  it('reads WASD as the arrows, so either hand navigates', () => {
    expect(directionFor({ key: 'w' })).toBe(directionFor({ key: 'ArrowUp' }))
    expect(directionFor({ key: 'a' })).toBe(directionFor({ key: 'ArrowLeft' }))
    expect(directionFor({ key: 's' })).toBe(directionFor({ key: 'ArrowDown' }))
    expect(directionFor({ key: 'd' })).toBe(directionFor({ key: 'ArrowRight' }))
    expect(directionFor({ key: 'w' })).toBe('up')
  })

  it('pages a pile on PageUp and PageDown, where left and right do', () => {
    expect(directionFor({ key: 'PageUp' })).toBe('left')
    expect(directionFor({ key: 'PageDown' })).toBe('right')
  })

  it('ignores case, so caps lock does not stop the wall', () => {
    expect(directionFor({ key: 'W' })).toBe('up')
  })

  it('leaves a modified keystroke to whoever owns it', () => {
    expect(directionFor({ key: 'w', metaKey: true })).toBeNull()
    expect(directionFor({ key: 'd', ctrlKey: true })).toBeNull()
    expect(directionFor({ key: 'ArrowUp', altKey: true })).toBeNull()
  })

  it('is null for a key the wall does not navigate by', () => {
    expect(directionFor({ key: 'q' })).toBeNull()
    expect(directionFor({ key: 'Escape' })).toBeNull()
    expect(directionFor({ key: ',' })).toBeNull()
  })
})

describe('opensIn', () => {
  it('opens on enter and on space, the two keys a list has always used', () => {
    expect(opensIn({ key: 'Enter' })).toBe(true)
    expect(opensIn({ key: ' ' })).toBe(true)
  })

  it('leaves a modified keystroke to whoever owns it', () => {
    expect(opensIn({ key: 'Enter', metaKey: true })).toBe(false)
    expect(opensIn({ key: ' ', ctrlKey: true })).toBe(false)
    expect(opensIn({ key: 'Enter', altKey: true })).toBe(false)
  })

  it('is false for the keys that navigate and the one that climbs out', () => {
    expect(opensIn({ key: 'ArrowRight' })).toBe(false)
    expect(opensIn({ key: 'w' })).toBe(false)
    expect(opensIn({ key: 'Escape' })).toBe(false)
  })
})

describe('deletes', () => {
  it('takes both delete keys, since a Mac calls Backspace delete', () => {
    expect(deletes({ key: 'Backspace' })).toBe(true)
    expect(deletes({ key: 'Delete' })).toBe(true)
  })

  it('leaves a modified delete to whoever owns it', () => {
    expect(deletes({ key: 'Backspace', metaKey: true })).toBe(false)
    expect(deletes({ key: 'Delete', altKey: true })).toBe(false)
  })

  it('is false for any other key', () => {
    expect(deletes({ key: 'Escape' })).toBe(false)
    expect(deletes({ key: 'd' })).toBe(false)
  })
})

describe('togglesList', () => {
  it('answers to L in either case', () => {
    expect(togglesList({ key: 'l' })).toBe(true)
    expect(togglesList({ key: 'L' })).toBe(true)
  })

  it('leaves a modified L alone', () => {
    expect(togglesList({ key: 'l', metaKey: true })).toBe(false)
  })
})

describe('isForAControl', () => {
  // The tests run without a DOM, so the target is faked the way the rest of
  // this repo fakes one: a `closest` that answers for a known selector.
  const target = (matches: string) =>
    ({ closest: (sel: string) => (sel.includes(matches) ? {} : null) }) as unknown as EventTarget

  it('claims a keystroke aimed at a field or a slider for the control', () => {
    expect(isForAControl(target('input'))).toBe(true)
    expect(isForAControl(target('select'))).toBe(true)
    expect(isForAControl(target('contenteditable'))).toBe(true)
  })

  it('leaves the wall itself alone', () => {
    expect(isForAControl(target('nothing-it-asks-about'))).toBe(false)
    expect(isForAControl(null)).toBe(false)
  })

  it('survives a target with no closest, which is not an element', () => {
    expect(isForAControl({} as EventTarget)).toBe(false)
  })
})

describe('sortFor', () => {
  const key = (k: string, mods: Partial<Parameters<typeof sortFor>[0]> = {}) =>
    sortFor({ key: k, ...mods })

  it('takes the sorts in the order the band lists them', () => {
    expect(key('F1')).toBe('project')
    expect(key('F2')).toBe('severity')
    expect(key('F3')).toBe('recency')
  })

  it('answers for no function key past the last sort', () => {
    expect(key('F4')).toBeNull()
    expect(key('F9')).toBeNull()
  })

  it('leaves an ordinary key alone', () => {
    expect(key('f')).toBeNull()
    expect(key('1')).toBeNull()
    expect(key('ArrowLeft')).toBeNull()
  })

  it('gives a modified function key back to whatever owns it', () => {
    expect(key('F1', { metaKey: true })).toBeNull()
    expect(key('F1', { ctrlKey: true })).toBeNull()
    expect(key('F1', { altKey: true })).toBeNull()
  })
})

describe('cyclesFollow', () => {
  it('takes F in either case and leaves a modified one alone', () => {
    expect(cyclesFollow({ key: 'f' })).toBe(true)
    expect(cyclesFollow({ key: 'F' })).toBe(true)
    expect(cyclesFollow({ key: 'f', metaKey: true })).toBe(false)
    expect(cyclesFollow({ key: 'l' })).toBe(false)
  })
})
