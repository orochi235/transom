import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ClientStale } from '@/dev/clientStale.ts'
import { defaultParams } from '@/params.ts'

vi.mock('delamin8r', () => ({ delaminate: () => ({ destroy: () => {} }) }))

const { TopBar } = await import('@/TopBar.tsx')

function band(pageStale: ClientStale | null) {
  return renderToStaticMarkup(
    <TopBar
      items={[]}
      now={0}
      range={null}
      onRange={() => {}}
      sort="recency"
      onSort={() => {}}
      kinds={new Set()}
      onKind={() => {}}
      hosts={new Set()}
      onHost={() => {}}
      where={null}
      arrangement="grid"
      count={0}
      connected
      stale={false}
      pageStale={pageStale}
      disk={null}
      look={defaultParams.band}
      allowParallax={false}
      listed={false}
      onList={() => {}}
    />,
  )
}

describe('TopBar page stale chip', () => {
  it('names the files the dev server missed', () => {
    const html = band({ files: ['src/App.tsx'], count: 1 })
    expect(html).toContain('page stale')
    expect(html).toContain('missed edits to src/App.tsx. Run transom cycle.')
  })

  it('counts the files it does not name', () => {
    expect(band({ files: ['a.ts', 'b.ts'], count: 7 })).toContain('a.ts, b.ts and 5 more.')
  })

  it('is absent while the dev server has heard every edit', () => {
    expect(band(null)).not.toContain('page stale')
  })
})
