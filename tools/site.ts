/**
 * Assembles the published site:
 *
 *   _site/        the landing page from `site/`
 *   _site/demo/   the client, built for the demo
 *
 * Run by `.github/workflows/site.yml`, and locally with `npm run site` to see
 * what it will publish before pushing.
 */
import { cp, mkdir, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const OUT = process.argv[3] ?? '_site'
/** Where GitHub Pages serves the wall from, which the bundle's asset URLs are
 *  written against. Overridable so a local check can serve it from `/`. */
const BASE = process.env.TRANSOM_SITE_BASE ?? '/transom/demo/'

const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv = {}) => {
  console.log(`  ${cmd} ${args.join(' ')}`)
  const res = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } })
  if (res.status !== 0) process.exit(res.status ?? 1)
}

await rm(OUT, { recursive: true, force: true })
await mkdir(`${OUT}/demo`, { recursive: true })

console.log('1/3  the landing page')
await cp('site', OUT, { recursive: true })
// The page is set in the wall's own faces. Copied rather than duplicated, so
// there is one of each file in the repo.
await cp('src/fonts', `${OUT}/fonts`, { recursive: true })
await cp('public/favicon.svg', `${OUT}/favicon.svg`)
// Where a repo's .transom.yaml points its editor: `SCHEMA_URL`.
await mkdir(`${OUT}/schema`, { recursive: true })
await cp('shared/transom.schema.json', `${OUT}/schema/transom.json`)

console.log('2/3  the wall, as the demo')
run('npx', ['vite', 'build', '--base', BASE, '--outDir', `${OUT}/demo`, '--emptyOutDir'], {
  VITE_TRANSOM_DEMO: '1',
})

console.log(`3/3  ${OUT}/ is ready`)
