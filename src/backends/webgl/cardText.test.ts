import { describe, expect, it } from 'vitest'
import { ageTextOf } from '@/backends/webgl/cardText.ts'

describe('ageTextOf', () => {
  it('reads the age alone for a card this Mac made', () => {
    expect(ageTextOf('4m', undefined)).toBe('4m')
  })

  it('names the Mac a card came from after its age', () => {
    expect(ageTextOf('4m', 'teitou')).toBe('4m · teitou')
  })
})
