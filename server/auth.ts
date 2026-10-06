import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import type { Request, RequestHandler } from 'express'

export async function loadToken(file: string): Promise<string> {
  const held = (await readFile(file, 'utf8').catch(() => '')).trim()
  if (/^[0-9a-f]{64}$/.test(held)) {
    await chmod(file, 0o600)
    return held
  }
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
  return b.length > 0 && a.length === b.length && timingSafeEqual(a, b)
}

/** Behind the page server's proxy every request arrives from loopback; the proxy appends the real peer to X-Forwarded-For. */
export function clientAddress(req: Pick<Request, 'socket' | 'headers'>): string | undefined {
  const addr = req.socket.remoteAddress
  const fwd = req.headers['x-forwarded-for']
  if (!isLoopback(addr) || typeof fwd !== 'string' || fwd.trim() === '') return addr
  return fwd.split(',').pop()!.trim()
}

/** `trustLoopback: false` is for tests, which can only ever call from loopback. */
export function guard(token: string, opts: { trustLoopback?: boolean } = {}): RequestHandler {
  const trust = opts.trustLoopback ?? true
  return (req, res, next) => {
    const addr = trust ? clientAddress(req) : undefined
    if (allowed(addr, req.headers.authorization, token)) return next()
    res.status(401).type('text').send('transom: this wall wants its token. Run `transom pair <this host>` on the wall.\n')
  }
}
