import { describe, expect, it } from 'vitest'
import { formatBytes, metaOf, statusOf } from '@/lightbox-meta.ts'
import type { WallItem } from '@shared/protocol.ts'

const item = (over: Partial<WallItem> = {}): WallItem => ({
  id: 'a',
  url: '/img/a',
  origUrl: '/orig/a',
  zone: 'transom',
  name: 'a render',
  path: '/transom/inbox/transom/a.png',
  bornAt: 0,
  w: 1024,
  h: 576,
  ...over,
})

describe('metaOf', () => {
  it("leads with the zone and the age, in the wall's own register", () => {
    expect(metaOf(item(), 240_000)).toEqual(['transom', '4m', 'png', '1024×576'])
  })

  it('says the repo only when it is not already the zone', () => {
    expect(metaOf(item({ repo: 'transom', sha: 'abc1234' }), 0)).toContain('abc1234')
    expect(metaOf(item({ repo: 'transom', sha: 'abc1234' }), 0)).not.toContain(
      'transom@abc1234',
    )
    expect(metaOf(item({ repo: 'weasel', sha: 'abc1234' }), 0)).toContain('weasel@abc1234')
  })

  it('says which Mac sent it, when that was not the wall\'s own', () => {
    expect(metaOf(item({ host: 'teitou' }), 240_000).slice(0, 3)).toEqual(['transom', '4m', 'from teitou'])
    expect(metaOf(item(), 0).join(' ')).not.toContain('from')
  })

  it('says nothing about provenance for a file dropped in by hand', () => {
    expect(metaOf(item(), 0)).toEqual(['transom', '0s', 'png', '1024×576'])
  })

  it('names the format the original is in, not the thumbnail the card drew', () => {
    expect(metaOf(item({ path: '/transom/inbox/z/a.ttl30m.gif' }), 0)).toContain('gif')
    expect(metaOf(item({ path: '/transom/inbox/z/A.JPEG' }), 0)).toContain('jpeg')
  })

  it('calls a page a page, since its card is only a screenshot of one', () => {
    expect(metaOf(item({ kind: 'page', path: '/transom/inbox/z/a.html' }), 0)).toContain('page')
    expect(metaOf(item({ kind: 'page', path: '/transom/inbox/z/a.html' }), 0)).not.toContain('html')
  })

  it('counts the frames of an animation, which no still card can show', () => {
    expect(metaOf(item({ path: '/transom/inbox/z/a.gif', frames: 88 }), 0)).toContain('88 frames')
    expect(metaOf(item(), 0).some((p) => p.endsWith('frames'))).toBe(false)
  })

  it('gives a video its runtime, which the poster cannot show', () => {
    const video = { kind: 'video' as const, path: '/transom/inbox/z/a.mp4', duration: 243_000 }
    expect(metaOf(item(video), 0)).toContain('4:03')
    // Its container, not the word "video": that is what `/orig` hands over.
    expect(metaOf(item(video), 0)).toContain('mp4')
  })

  it('leaves the runtime out of a container that declared none', () => {
    const parts = metaOf(item({ kind: 'video', path: '/transom/inbox/z/a.webm' }), 0)
    expect(parts.some((p) => p.includes(':'))).toBe(false)
  })

  it('gives a mesh its file size, and drops the poster size it would lie with', () => {
    const mesh = { kind: 'mesh' as const, path: '/transom/inbox/z/head.glb', bytes: 4_404_019 }
    const parts = metaOf(item({ ...mesh, w: 1024, h: 1024 }), 0)
    expect(parts).toContain('glb')
    expect(parts).toContain('4.2 MB')
    expect(parts).not.toContain('1024×1024')
  })

  it('says nothing about a format for a file expiry has already renamed', () => {
    expect(metaOf(item({ path: '/transom/trash/abc123-transom' }), 0)).toEqual([
      'transom',
      '0s',
      '1024×576',
    ])
  })
})

describe('statusOf', () => {
  it('says whether a drawing is waiting on a session, held for nobody, or sent', () => {
    const markup = { text: '', at: 1, url: '/api/marks/a.png' }
    expect(statusOf(item({ markup: { ...markup, status: 'pending', live: true } }))).toEqual(['marks unsent'])
    expect(statusOf(item({ markup: { ...markup, status: 'pending', live: false } }))).toEqual(['marks held'])
    expect(statusOf(item({ markup: { ...markup, status: 'delivered', via: 'hook', live: true } }))).toEqual([
      'marks sent',
    ])
    expect(statusOf(item({ markup: { ...markup, status: 'discarded', live: false } }))).toEqual([])
  })

  it('says nothing about an artifact that is in no particular state', () => {
    expect(statusOf(item())).toEqual([])
  })

  it('marks a rescued item, since nothing else about it says so', () => {
    expect(statusOf(item({ keptAt: 5 }))).toEqual(['kept'])
  })

  it('carries the flag and the level an asking card wears on the wall', () => {
    expect(statusOf(item({ note: 'broken', attention: { level: 'urgent', holdMs: null } }))).toEqual(
      ['broken', 'urgent'],
    )
  })

  it('says whether a question is still open, and how it closed if it is not', () => {
    expect(statusOf(item({ question: 'ship it?' }))).toEqual(['needs a response'])
    expect(
      statusOf(item({ question: 'ship it?', reply: { status: 'answered', text: 'yes', at: 1 } })),
    ).toEqual(['responded'])
    // A question nobody answered says how it closed instead: "responded" would
    // be a claim nobody made.
    expect(
      statusOf(item({ question: 'ship it?', reply: { status: 'dismissed', text: '', at: 1 } })),
    ).toEqual(['dismissed'])
  })

  it('says a group needs a response while any of its takes does', () => {
    const take = (id: string, answered: boolean) => ({
      id,
      url: `/img/${id}`,
      origUrl: `/orig/${id}`,
      name: id,
      path: `/p/${id}.png`,
      at: 1,
      w: 10,
      h: 10,
      question: 'reads?',
      ...(answered ? { reply: { status: 'answered' as const, text: '', at: 2 } } : {}),
    })
    expect(statusOf(item({ kind: 'group', takes: [take('t1', true), take('t2', false)] }))).toEqual([
      'needs a response',
    ])
    expect(statusOf(item({ kind: 'group', takes: [take('t1', true)] }))).toEqual(['responded'])
  })
})

describe('formatBytes', () => {
  it('says a size the way a reader says it', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(4_404_019)).toBe('4.2 MB')
    expect(formatBytes(1_073_741_824)).toBe('1.0 GB')
  })

  it('drops the decimal once it stops meaning anything', () => {
    expect(formatBytes(83_100)).toBe('81 KB')
    expect(formatBytes(9_000)).toBe('8.8 KB')
  })
})
