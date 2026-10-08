const pad = (n: number) => String(n).padStart(2, '0')

export const stamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

/** launchd writes stdout to the log untouched, so without this no line says
 *  when it happened and the arrival rate cannot be read back out. */
export function stampConsole(now = () => new Date()): void {
  for (const level of ['log', 'warn', 'error'] as const) {
    const write = console[level].bind(console)
    console[level] = (...args: unknown[]) => write(stamp(now()), ...args)
  }
}
