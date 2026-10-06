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
  it('reads zero as unset, not as a cap of nothing', () => {
    expect(parseBytes('0', 7)).toBe(7)
    expect(parseBytes('0G', 7)).toBe(7)
    expect(parseBytes('0.0001', 7)).toBe(7)
  })
})
