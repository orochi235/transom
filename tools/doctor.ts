/**
 * What is actually running, and whether it is running this code.
 *
 * The daemon and the client are LaunchAgents — detached, `KeepAlive`, and
 * started with no `watch`. A daemon therefore goes on serving whatever build it
 * was launched from however many times `server/` changes, and every symptom of
 * that reads as a broken feature rather than as a stale process. This is the
 * thing to run first when the wall does not do what the code says it should.
 */
import { execFileSync } from 'node:child_process'
import { agree, DAEMON_PATHS, describe, type Build } from '@shared/build.ts'
import { stamp } from '../server/build.ts'
import { CLIENT_PORT as CLIENT, DAEMON_PORT as DAEMON } from '../server/ports.ts'

const run = (cmd: string, ...args: string[]): string => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}


const pidOn = (port: number): string => run('lsof', '-ti', `:${port}`, '-sTCP:LISTEN').split('\n')[0] ?? ''

const startedAt = (pid: string): string =>
  pid ? (run('ps', '-o', 'lstart=', '-p', pid) || 'unknown') : '—'

const daemonBuild = async (): Promise<Build | null> => {
  try {
    const res = await fetch(`http://localhost:${DAEMON}/api/build`)
    return res.ok ? ((await res.json()) as Build) : null
  } catch {
    return null
  }
}

const agents = (): string[] =>
  run('launchctl', 'list')
    .split('\n')
    .filter((line) => line.includes('transom'))
    .map((line) => {
      const [pid, , label] = line.split('\t')
      return `  ${(label ?? '').padEnd(42)} pid ${pid === '-' ? '(not running)' : pid}`
    })

/** Homebrew's one service, where `brew services` runs the wall instead of the
 *  pair `transom install` writes. Its pid is tsx's, not the listener's, so
 *  being up is the evidence that the daemon on the port is its. */
const brewed = (): boolean =>
  run('launchctl', 'list')
    .split('\n')
    .some((line) => {
      const [pid, , label] = line.split('\t')
      return label === 'tech.michaelbaker.transom' && pid !== '-'
    })

const main = async () => {
  const code = stamp()
  const daemon = await daemonBuild()
  const daemonPid = pidOn(DAEMON)
  const clientPid = pidOn(CLIENT)

  console.log(`code on disk   ${describe(code)}${code.dirty ? '  (uncommitted changes)' : ''}`)
  console.log('')
  console.log(`daemon :${DAEMON}   ${daemonPid ? `pid ${daemonPid}` : 'NOT RUNNING'}`)
  const keg = daemonPid !== '' && brewed()
  if (keg) {
    console.log("               Homebrew's service, running its keg and not this checkout.")
    console.log('               To run this checkout: brew services stop transom && bin/transom install')
    console.log(`               started ${startedAt(daemonPid)}`)
  } else if (daemon) {
    console.log(`               build ${describe(daemon)}`)
    console.log(`               started ${startedAt(daemonPid)}`)
    if (!agree(daemon, code)) {
      const behind = run('git', 'rev-list', '--count', `${daemon.sha}..HEAD`, '--', ...DAEMON_PATHS)
      console.log(
        `               STALE — ${behind ? `${behind} daemon commits behind` : 'a different build'}.`,
      )
      console.log('               Fix: npm run daemon:restart')
    }
  } else if (daemonPid) {
    console.log('               build unknown — this daemon predates /api/build, so it is stale.')
    console.log('               Fix: npm run daemon:restart')
  }
  console.log('')
  console.log(`client :${CLIENT}   ${clientPid ? `pid ${clientPid}` : 'NOT RUNNING'}`)
  if (clientPid) console.log(`               started ${startedAt(clientPid)}`)
  console.log(
    keg
      ? '               The page built into the keg, served by the daemon.'
      : '               Vite reloads itself, so the client is never stale.',
  )

  const listed = agents()
  if (listed.length > 0) {
    console.log('')
    console.log('launch agents')
    for (const line of listed) console.log(line)
  }
}

void main()
