import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allowed, isLoopback, loadToken } from './auth.ts'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'transom-auth-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('loadToken', () => {
  it('makes one the first time, readable only by its owner, and reuses it after', async () => {
    const file = join(dir, 'token')
    const first = await loadToken(file)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(await loadToken(file)).toBe(first)
    expect((await readFile(file, 'utf8')).trim()).toBe(first)
  })
})

describe('allowed', () => {
  it('lets loopback through without a token', () => {
    for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(isLoopback(a)).toBe(true)
    expect(allowed('::1', undefined, 't')).toBe(true)
  })
  it('wants the bearer token from anywhere else', () => {
    expect(allowed('192.168.1.9', undefined, 't')).toBe(false)
    expect(allowed('192.168.1.9', 'Bearer nope', 't')).toBe(false)
    expect(allowed('192.168.1.9', 'Bearer t', 't')).toBe(true)
  })
})
