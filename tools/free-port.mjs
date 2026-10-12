/**
 * Refuse to start a dev daemon behind the LaunchAgent one, and say what to do.
 *
 * `tech.michaelbaker.transom.daemon` holds 8787 with `KeepAlive`, so
 * `npm run dev` would otherwise die with a bare `EADDRINUSE` scrolling past
 * inside `concurrently` while the client comes up fine — which looks like a
 * working dev server in front of a daemon that never picks up an edit.
 */
import { execFileSync } from 'node:child_process'

const port = Number(process.argv[2])

const pid = (() => {
  try {
    return execFileSync('lsof', ['-ti', `:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split('\n')[0]
  } catch {
    return ''
  }
})()

if (!pid) process.exit(0)

console.error(`
Port ${port} is already held by pid ${pid}.

If that is the LaunchAgent daemon, it is the one the wall is talking to and it
does not reload — restart it instead of starting a second:

    npm run daemon:restart

If it is Homebrew's service, it runs the keg and not this checkout — stop it:

    brew services stop transom

To see what is running and whether it matches this checkout:

    npm run doctor
`)
process.exit(1)
