import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'
import {
  hasWaiting,
  MAX_SEND_BYTES,
  SCHEMA_INBOX_EVENT,
  SCHEMA_INBOX_FILE,
  SCHEMA_INBOX_ROUTE,
  sendOf,
  withSend,
} from './schemaInbox.ts'

/** A request's body as text, or null once it runs past `max` bytes. */
function bodyOf(req: IncomingMessage, max: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= max) parts.push(chunk)
    })
    req.on('end', () => resolve(size > max ? null : Buffer.concat(parts).toString()))
    req.on('error', reject)
  })
}

/**
 * The dev server's side of the schema page's Send: each one is written as a
 * line of `SCHEMA_INBOX_FILE`, which the agent working in this checkout reads
 * and removes once it has applied it. The page is told whether one is still
 * waiting, on a GET and as the file changes.
 */
export function schemaInbox(opts: { root: string }): Plugin {
  const file = join(opts.root, SCHEMA_INBOX_FILE)
  const waiting = () => hasWaiting(existsSync(file) ? readFileSync(file, 'utf8') : '')

  return {
    name: 'transom-schema-inbox',
    apply: 'serve',
    configureServer(server) {
      server.watcher.add(file)
      server.watcher.on('all', (_event, changed) => {
        if (changed === file) server.ws.send(SCHEMA_INBOX_EVENT, { waiting: waiting() })
      })
      server.middlewares.use((req, res, next) => {
        if (req.url !== SCHEMA_INBOX_ROUTE) return next()
        if (req.method === 'GET') {
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ waiting: waiting() }))
          return
        }
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        bodyOf(req, MAX_SEND_BYTES)
          .then((text) => {
            const send = text === null ? null : sendOf(text)
            if (!send) {
              res.statusCode = text === null ? 413 : 400
              res.end()
              return
            }
            mkdirSync(dirname(file), { recursive: true })
            const had = existsSync(file) ? readFileSync(file, 'utf8') : ''
            writeFileSync(file, withSend(had, send, new Date().toISOString()))
            server.config.logger.info(`transom schema: sent to ${file}`)
            res.statusCode = 204
            res.end()
          })
          .catch((e: unknown) => {
            server.config.logger.error(`transom schema: ${e instanceof Error ? e.message : e}`)
            if (!res.headersSent) res.statusCode = 500
            res.end()
          })
      })
    },
  }
}
