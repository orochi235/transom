import { afterEach, describe, expect, it } from 'vitest'
import { stamp, stampConsole } from './stamp.ts'

describe('stamp', () => {
  it('writes local time, zero-padded', () => {
    expect(stamp(new Date(2026, 0, 5, 7, 3, 9))).toBe('2026-01-05 07:03:09')
  })
})

describe('stampConsole', () => {
  const saved = { log: console.log, warn: console.warn, error: console.error }
  afterEach(() => Object.assign(console, saved))

  it('puts the time in front of every line', () => {
    const seen: unknown[][] = []
    console.log = (...args: unknown[]) => void seen.push(args)
    stampConsole(() => new Date(2026, 9, 8, 19, 41, 0))
    console.log('[arrive] astv/1f42b8b6')
    expect(seen).toEqual([['2026-10-08 19:41:00', '[arrive] astv/1f42b8b6']])
  })
})
