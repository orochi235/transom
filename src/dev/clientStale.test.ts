import { describe, expect, it } from 'vitest'
import { ledger } from '@/dev/clientStale.ts'

describe('ledger', () => {
  it('claims nothing while the disk matches what was served', () => {
    const book = ledger()
    book.served('/a.ts', 100)
    expect(book.stale(() => 100)).toEqual([])
  })

  it('names a file edited without a word from the watcher', () => {
    const book = ledger()
    book.served('/b.ts', 100)
    book.served('/a.ts', 100)
    expect(book.stale((f) => (f === '/a.ts' ? 200 : 100))).toEqual(['/a.ts'])
  })

  it('counts a deleted file as changed', () => {
    const book = ledger()
    book.served('/a.ts', 100)
    expect(book.stale(() => null)).toEqual(['/a.ts'])
  })

  it('drops a file the watcher reported until it is served again', () => {
    const book = ledger()
    book.served('/a.ts', 100)
    book.heard('/a.ts')
    expect(book.stale(() => 200)).toEqual([])
    book.served('/a.ts', 200)
    expect(book.stale(() => 200)).toEqual([])
  })
})
