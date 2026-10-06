import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Disk } from '@shared/protocol.ts'
import { defaultParams } from '@/params.ts'

vi.mock('delamin8r', () => ({ delaminate: () => ({ destroy: () => {} }) }))

const { TopBar } = await import('@/TopBar.tsx')

const GB = 1024 ** 3

function band(disk: Disk | null) {
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
      where={null}
      arrangement="grid"
      count={0}
      connected
      stale={false}
      disk={disk}
      look={defaultParams.band}
      allowParallax={false}
      listed={false}
      onList={() => {}}
    />,
  )
}

describe('TopBar disk chip', () => {
  it('shows when pinned cards exceed the cap, naming both sizes', () => {
    const html = band({ wallBytes: 25 * GB, wallMax: 20 * GB, trashBytes: 0, over: true })
    expect(html).toContain('topbar__disk')
    expect(html).toContain('25.0 GB')
    expect(html).toContain('20.0 GB')
  })

  it('names every kind of card the wall may not evict', () => {
    const html = band({ wallBytes: 25 * GB, wallMax: 20 * GB, trashBytes: 0, over: true })
    expect(html).toContain('Cards the wall may not evict (pinned, eternal zones, open questions, undelivered drawings) hold 25.0 GB')
  })

  it('is absent while under the cap', () => {
    const html = band({ wallBytes: 5 * GB, wallMax: 20 * GB, trashBytes: 0, over: false })
    expect(html).not.toContain('topbar__disk')
  })

  it('is absent before the daemon has sent a summary', () => {
    expect(band(null)).not.toContain('topbar__disk')
  })
})
