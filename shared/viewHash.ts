/** A view path as the wall's URL fragment — `#/weasel/img-1`, or empty for the
 *  wall. Shared so the daemon's links and the page's own URL cannot disagree. */
export function hashOfPath(path: readonly string[]): string {
  return path.length === 0 ? '' : `#/${path.map(encodeURIComponent).join('/')}`
}
