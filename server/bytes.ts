const UNITS: Record<string, number> = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }

/** A size as a person writes it — `10G`, `500M`, `64k`, or bytes. */
export function parseBytes(text: string | undefined, fallback: number): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kmg]?)b?\s*$/i.exec(text ?? '')
  if (!m) return fallback
  return Math.round(Number(m[1]) * UNITS[m[2]!.toLowerCase()]!)
}
