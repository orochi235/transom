/**
 * What build a process is running, so a wall can say when the daemon behind it
 * is older than the code on disk.
 *
 * The daemon runs as a LaunchAgent with `KeepAlive` and no `watch`, so it goes
 * on serving whatever it was started from however many times the source
 * changes — silently, which is the whole problem. Every symptom of that looks
 * like a bug in the feature the daemon has not heard of yet.
 */
export type Build = {
  /** Short sha of the last commit that changed the daemon's code as of when the
   *  process started, or `unknown` outside a checkout. Not HEAD: a commit that
   *  touches only the client leaves a running daemon current. */
  sha: string
  /** Whether the daemon's code had uncommitted changes at that moment. A dirty
   *  tree makes the sha a weaker claim, not a wrong one. */
  dirty: boolean
  /** A hash of the uncommitted changes to the daemon's code, empty when clean,
   *  so two different dirty trees on one sha do not read as the same build.
   *  Absent from a daemon older than the field. */
  tree?: string
  /** When the process started, which dates the sha. */
  startedAt: number
}

/** What the daemon runs: its own source, the code it shares with the wall, and
 *  its dependencies. */
export const DAEMON_PATHS = ['server', 'shared', 'package.json', 'package-lock.json']

export const UNKNOWN: Build = { sha: 'unknown', dirty: false, startedAt: 0 }

/**
 * Whether two builds disagree about what code is running. Unknown on either
 * side answers false: a clone with no git, or a published demo, has nothing to
 * compare and a chip crying stale on every load is worse than no chip.
 */
export function agree(a: Build, b: Build): boolean {
  if (a.sha === 'unknown' || b.sha === 'unknown') return true
  if (a.sha !== b.sha) return false
  return a.tree === undefined || b.tree === undefined || a.tree === b.tree
}

/** How to say a build in one short line, for a chip or a doctor's report. */
export function describe(build: Build): string {
  if (build.sha === 'unknown') return 'unknown'
  return `${build.sha}${build.dirty ? `+${build.tree ?? ''}` : ''}`
}
