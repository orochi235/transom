import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WallItem } from '@shared/protocol.ts'
import { defaultParams } from '@/params.ts'

vi.mock('delamin8r', () => ({ delaminate: () => ({ destroy: () => {} }) }))

const { TopBar } = await import('@/TopBar.tsx')

const item = (id: string, host?: string): WallItem =>
  ({ id, zone: 'z', name: `${id}.png`, url: `/${id}`, path: `/${id}`, bornAt: 0, w: 1, h: 1, host }) as WallItem

function band(items: WallItem[], hosts: string[] = []) {
  return renderToStaticMarkup(
    <TopBar
      items={items}
      now={0}
      range={null}
      onRange={() => {}}
      sort="recency"
      onSort={() => {}}
      kinds={new Set()}
      onKind={() => {}}
      hosts={new Set(hosts)}
      onHost={() => {}}
      where={null}
      arrangement="grid"
      count={items.length}
      connected
      stale={false}
      pageStale={null}
      disk={null}
      look={defaultParams.band}
      allowParallax={false}
      listed={false}
      onList={() => {}}
    />,
  )
}

/** The text of each row in the `from` panel, or null when the band has none. */
const rows = (html: string): string[] | null => {
  const panel = html.split('<fieldset').find((part) => part.includes('>from</legend>'))
  if (!panel) return null
  return [...panel.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''))
}

describe('TopBar from panel', () => {
  it('is absent while every card is local', () => {
    expect(rows(band([item('a'), item('b')]))).toBeNull()
  })

  it('lists the wall\'s own cards as local, then each sending Mac with its tally', () => {
    expect(rows(band([item('a'), item('b', 'studio'), item('c', 'studio'), item('d', 'mini')]))).toEqual([
      'local1',
      'mini1',
      'studio2',
    ])
  })
})
