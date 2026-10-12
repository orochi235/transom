import express, { type Express } from 'express'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The built page, served by the daemon itself. A checkout runs vite beside the
 * daemon and never needs this; an installed copy has no dev server, so the
 * daemon is the whole wall. Mounted after every route, so no built file can
 * shadow one. False when `dir` holds no build.
 */
export function mountPage(app: Express, dir: string): boolean {
  if (!existsSync(join(dir, 'index.html'))) return false
  app.use(express.static(dir))
  return true
}
