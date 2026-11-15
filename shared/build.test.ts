import { describe as suite, expect, it } from 'vitest'
import { agree, describe, UNKNOWN, type Build } from './build.ts'

const b = (sha: string, tree?: string): Build => ({ sha, dirty: !!tree, tree, startedAt: 0 })

suite('agree', () => {
  it('tells two different dirty trees on one sha apart', () => {
    expect(agree(b('abc', '11111111'), b('abc', '22222222'))).toBe(false)
    expect(agree(b('abc', '11111111'), b('abc', '11111111'))).toBe(true)
  })
  it('tells a clean start from a later dirty tree', () => {
    expect(agree(b('abc', ''), b('abc', '11111111'))).toBe(false)
  })
  it('compares only the sha against a daemon that predates the tree hash', () => {
    expect(agree({ sha: 'abc', dirty: true, startedAt: 0 }, b('abc', '11111111'))).toBe(true)
  })
  it('agrees with an unknown build', () => {
    expect(agree(UNKNOWN, b('abc', '11111111'))).toBe(true)
  })
  it('says a dirty build with its tree', () => {
    expect(describe(b('abc', '11111111'))).toBe('abc+11111111')
  })
})
