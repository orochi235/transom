import { describe, expect, it } from 'vitest'
import { isLive, sawSession, REMOTE_LIVE_MS, REMOTE_SESSIONS_MAX } from './markup.ts'

describe('a sender on another host', () => {
  it('is live while its session has asked the wall for marks recently', async () => {
    const sender = { session: 's-remote', pid: 99999, host: 'studio' }
    expect(await isLive(sender, 1_000_000)).toBe(false)
    sawSession('s-remote', 1_000_000)
    expect(await isLive(sender, 1_000_000 + REMOTE_LIVE_MS - 1)).toBe(true)
    expect(await isLive(sender, 1_000_000 + REMOTE_LIVE_MS + 1)).toBe(false)
  })

  it('forgets a session that has gone quiet once another one is seen', async () => {
    const old = { session: 's-old', host: 'studio' }
    sawSession('s-old', 2_000_000)
    expect(await isLive(old, 2_000_001)).toBe(true)
    sawSession('s-new', 2_000_000 + REMOTE_LIVE_MS + 1)
    expect(await isLive(old, 2_000_001)).toBe(false)
  })

  it('ignores an absurdly long session id', async () => {
    const long = 'x'.repeat(129)
    sawSession(long, 3_000_000)
    expect(await isLive({ session: long, host: 'studio' }, 3_000_001)).toBe(false)
  })

  it('remembers at most a fixed number of sessions, dropping the oldest', async () => {
    for (let i = 0; i <= REMOTE_SESSIONS_MAX; i++) sawSession(`cap-${i}`, 4_000_000)
    expect(await isLive({ session: 'cap-0', host: 'h' }, 4_000_001)).toBe(false)
    expect(await isLive({ session: 'cap-1', host: 'h' }, 4_000_001)).toBe(true)
    expect(await isLive({ session: `cap-${REMOTE_SESSIONS_MAX}`, host: 'h' }, 4_000_001)).toBe(true)
  })
})
