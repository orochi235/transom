import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { DAEMON_PATHS, UNKNOWN, type Build } from '@shared/build.ts'

/** The checkout this file lives in, not the process's cwd: the daemon runs
 *  from a LaunchAgent, whose working directory is not the repo. */
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const git = (...args: string[]): string =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }).trim()

/** The uncommitted changes to the daemon's code, tracked and untracked, as one hash. */
function treeHash(): string {
  const diff = git('diff', 'HEAD', '--binary', '--', ...DAEMON_PATHS)
  const untracked = git('ls-files', '--others', '--exclude-standard', '--', ...DAEMON_PATHS)
  if (!diff && !untracked) return ''
  const h = createHash('sha1').update(diff)
  for (const f of untracked.split('\n').filter(Boolean)) h.update(`\0${f}\0`).update(readFileSync(resolve(repo, f)))
  return h.digest('hex').slice(0, 8)
}

/** The daemon's code as it stands on disk right now. */
export function stamp(): Build {
  try {
    const tree = treeHash()
    return {
      sha: git('log', '-1', '--format=%h', '--', ...DAEMON_PATHS),
      dirty: tree !== '',
      tree,
      startedAt: 0,
    }
  } catch {
    // No git, or no checkout — a published copy running from a tarball. The
    // wall compares unknowns as agreeing, so this reports nothing rather than
    // crying stale forever.
    return UNKNOWN
  }
}

/**
 * What this process is running, read once at start — which is the point. The
 * gap between this and `stamp()` read later is the whole thing being measured.
 */
export const build: Build = { ...stamp(), startedAt: Date.now() }
