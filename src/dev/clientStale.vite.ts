import { statSync } from 'node:fs'
import { isAbsolute, relative } from 'node:path'
import type { Plugin } from 'vite'
import { CLIENT_STALE_ROUTE, ledger, MAX_LISTED, type ClientStale } from './clientStale.ts'

const mtimeOf = (file: string): number | null => {
  try {
    return statSync(file).mtimeMs
  } catch {
    return null
  }
}

/** The dev server's side of the `page stale` chip. See `clientStale.ts`. */
export function clientStale(opts: { root: string }): Plugin {
  const book = ledger()

  return {
    name: 'transom-client-stale',
    apply: 'serve',
    transform(_code, id) {
      const file = id.split('?')[0]!
      if (!isAbsolute(file) || file.includes('/node_modules/')) return
      const mtime = mtimeOf(file)
      if (mtime !== null) book.served(file, mtime)
    },
    configureServer(server) {
      server.watcher.on('all', (_event, file) => book.heard(file))
      server.middlewares.use((req, res, next) => {
        if (req.url !== CLIENT_STALE_ROUTE) return next()
        const files = book.stale(mtimeOf)
        const body: ClientStale = {
          files: files.slice(0, MAX_LISTED).map((f) => relative(opts.root, f)),
          count: files.length,
        }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(body))
      })
    },
  }
}
