import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import type { RequestHandler } from 'express'

export async function loadToken(file: string): Promise<string> {
  const held = (await readFile(file, 'utf8').catch(() => '')).trim()
  if (/^[0-9a-f]{64}$/.test(held)) return held
  const made = randomBytes(32).toString('hex')
  await writeFile(file, `${made}\n`, { mode: 0o600 })
  await chmod(file, 0o600)
  return made
}

export const isLoopback = (addr: string | undefined) =>
  addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'

export function allowed(addr: string | undefined, authorization: string | undefined, token: string): boolean {
  if (isLoopback(addr)) return true
  const given = /^Bearer (.+)$/.exec(authorization ?? '')?.[1] ?? ''
  const a = Buffer.from(given)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** `trustLoopback: false` is for tests, which can only ever call from loopback. */
export function guard(token: string, opts: { trustLoopback?: boolean } = {}): RequestHandler {
  const trust = opts.trustLoopback ?? true
  return (req, res, next) => {
    const addr = trust ? req.socket.remoteAddress : undefined
    if (allowed(addr, req.headers.authorization, token)) return next()
    res.status(401).type('text').send('transom: this wall wants its token. Run `transom pair <this host>` on the wall.\n')
  }
}
