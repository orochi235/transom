import chokidar from 'chokidar'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { config } from './config.ts'
import { type Hued, parseHued } from '../shared/hued.ts'

const zonesDir = join(config.root, 'zones')

/**
 * A color per zone, taken from the `.hued` file of the project the zone's
 * renders come from. `bin/transom` records that project on every send, so a repo
 * appears here by rendering once and never by being registered. The browser
 * cannot read either file, so the daemon owns this and publishes it; a zone
 * with no record or no `.hued` simply has no entry, and the wall falls back to
 * its own palette.
 */
export async function readZoneColors(): Promise<Record<string, string>> {
  return pick(await readZoneHued(), 'background')
}

/** An SF Symbol per zone, from the same `.hued`'s `sfkey`. Only the menu bar
 *  widget draws it; the browser has no SF Symbols. */
export async function readZoneIcons(): Promise<Record<string, string>> {
  return pick(await readZoneHued(), 'sfkey')
}

function pick(hued: Record<string, Hued>, key: keyof Hued): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [zone, h] of Object.entries(hued)) {
    const value = h[key]
    if (value) out[zone] = value
  }
  return out
}

async function readZoneHued(): Promise<Record<string, Hued>> {
  let names: string[]
  try {
    names = (await readdir(zonesDir)).filter((n) => n.endsWith('.json'))
  } catch {
    return {}
  }

  const out: Record<string, Hued> = {}
  await Promise.all(
    names.map(async (name) => {
      const zone = basename(name, '.json')
      try {
        const { root, hued } = JSON.parse(await readFile(join(zonesDir, name), 'utf8'))
        if (typeof hued === 'string') return void (out[zone] = parseHued(hued))
        if (typeof root !== 'string' || !root) return
        out[zone] = parseHued(await readFile(join(root, '.hued'), 'utf8'))
      } catch {
        // No `.hued`, an unreadable project directory, or a record written
        // half-way through a send. Not an error: most zones have no color.
      }
    }),
  )
  return out
}

/** Re-reads whenever a zone record or any recorded project's `.hued` changes,
 *  so recoloring a project reaches the wall without restarting the daemon. */
export function watchZoneColors(
  onChange: (colors: Record<string, string>, icons: Record<string, string>) => void,
) {
  let watcher: ReturnType<typeof chokidar.watch> | null = null

  const rescan = async () => {
    const hued = await readZoneHued()
    onChange(pick(hued, 'background'), pick(hued, 'sfkey'))

    const roots: string[] = []
    try {
      const names = (await readdir(zonesDir)).filter((n) => n.endsWith('.json'))
      await Promise.all(
        names.map(async (name) => {
          try {
            const { root, hued } = JSON.parse(await readFile(join(zonesDir, name), 'utf8'))
            if (typeof hued !== 'string' && typeof root === 'string' && root) roots.push(join(root, '.hued'))
          } catch {
            // Unreadable record; nothing to watch for it.
          }
        }),
      )
    } catch {
      // No zones directory yet. Watching it still picks one up when it appears.
    }
    await watcher?.close()
    watcher = chokidar.watch([zonesDir, ...roots], { ignoreInitial: true })
    watcher.on('all', () => void rescan())
  }

  void rescan()
  return () => void watcher?.close()
}
