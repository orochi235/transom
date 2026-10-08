/**
 * The carousel renders — that a group's lightbox draws at all, with its chips,
 * its comment box, its counter, the ways out and the edge triangles.
 *
 * A string render rather than a DOM one: the wall is the only place this code
 * runs, it runs there the moment a card is opened, and there is no jsdom here
 * to mount it in. `window.innerWidth` is all the picture lightbox reads during
 * a render, so that is all this stands up.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Take, WallItem } from '@shared/protocol.ts'

beforeAll(() => {
  Object.assign(globalThis, { window: { innerWidth: 1200, innerHeight: 800 } })
})

const take = (id: string, over: Partial<Take> = {}): Take => ({
  id,
  url: `/img/${id}`,
  origUrl: `/orig/${id}`,
  name: id,
  path: `/transom/inbox/z/${id}.png`,
  at: 1000,
  w: 480,
  h: 320,
  question: 'how does this read?',
  choices: ['no change', 'worse', 'neutral', 'better', 'fixed'],
  why: 'anything to add?',
  ...over,
})

const group = (takes: Take[], of?: number): WallItem => ({
  id: 'run1',
  kind: 'group',
  takes,
  ...(of === undefined ? {} : { group: { of, label: 'outline sweep' } }),
  url: takes[0]!.url,
  origUrl: takes[0]!.origUrl,
  zone: 'brick-icons',
  name: 'outline sweep',
  path: takes[0]!.path,
  bornAt: 1000,
  w: 480,
  h: 320,
})

async function draw(item: WallItem) {
  const { Lightbox } = await import('@/Lightbox.tsx')
  return renderToStaticMarkup(
    <Lightbox
      item={item}
      now={2000}
      quietMs={0}
      closing={false}
      onClose={() => {}}
      onAnswer={() => {}}
      onDismiss={() => {}}
    />,
  )
}

describe('a group in the lightbox', () => {
  it('draws the take the card was asking about, with its chips and its box', async () => {
    const html = await draw(group([take('t1', { reply: { status: 'answered', choice: 'worse', text: '', at: 1 } }), take('t2')], 12))
    // The first unanswered take, not the first take.
    expect(html).toContain('/orig/t2')
    expect(html).not.toContain('/orig/t1')
    for (const chip of ['no change', 'worse', 'neutral', 'better', 'fixed']) {
      expect(html).toContain(chip)
    }
    expect(html).toContain('anything to add?')
    expect(html).toContain('lightbox__count')
    // Out of what the group said was coming, not out of what has arrived.
    expect(html).toContain('2/12')
    // Dismiss is there and is not one of the chips.
    expect(html).toContain('lightbox__skip')
  })

  it('draws a triangle only on a side that has a take', async () => {
    const first = await draw(group([take('t1'), take('t2')]))
    expect(first).toContain('lightbox__step--next')
    expect(first).not.toContain('lightbox__step--prev')

    const only = await draw(group([take('t1')]))
    expect(only).not.toContain('lightbox__step--next')
    expect(only).not.toContain('lightbox__step--prev')
  })

  it('draws the ways out the take offers, and nothing when it offers none', async () => {
    const with_ = await draw(
      group([
        take('t1', {
          apps: [{ name: 'LDView', path: '/p/3001.dat' }],
          links: [{ label: 'part 3001', url: 'https://example.com/3001' }],
        }),
      ]),
    )
    expect(with_).toContain('Open in LDView')
    expect(with_).toContain('https://example.com/3001')
    expect(with_).toContain('rel="noopener noreferrer"')

    expect(await draw(group([take('t1')]))).not.toContain('lightbox__outs')
  })

  it('shows a closed take its own reply rather than asking again', async () => {
    const html = await draw(
      group([take('t1', { reply: { status: 'answered', choice: 'fixed', text: 'that is the one', at: 1 } })]),
    )
    expect(html).toContain('data-closed')
    expect(html).toContain('that is the one')
    expect(html).toContain('data-chosen')
  })

  it('still draws an ordinary card, which has no takes at all', async () => {
    const { takes: _none, kind: _group, ...card } = group([take('t1')])
    const html = await draw({ ...card, question: 'what is wrong with it?' })
    expect(html).toContain('what is wrong with it?')
    expect(html).not.toContain('lightbox__step')
  })
})
