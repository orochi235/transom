import { describe, expect, it } from 'vitest'
import { isLive, sawSession, REMOTE_LIVE_MS } from './markup.ts'

describe('a sender on another host', () => {
  it('is live while its session has asked the wall for marks recently', async () => {
    const sender = { session: 's-remote', pid: 99999, host: 'studio' }
    expect(await isLive(sender, 1_000_000)).toBe(false)
    sawSession('s-remote', 1_000_000)
    expect(await isLive(sender, 1_000_000 + REMOTE_LIVE_MS - 1)).toBe(true)
    expect(await isLive(sender, 1_000_000 + REMOTE_LIVE_MS + 1)).toBe(false)
  })
})
