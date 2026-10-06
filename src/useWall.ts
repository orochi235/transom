import { useCallback, useEffect, useRef, useState } from 'react'
import { ALERTS } from '@shared/attention.ts'
import type { Alert, Disk, WallItem, ZoneSettings } from '@shared/protocol.ts'
import { agree, type Build } from '@shared/build.ts'
import { actions, type ZonePatch } from '@/actions.ts'
import { subscribe } from '@/transport.ts'

export type { ZonePatch }

export type Wall = {
  items: WallItem[]
  /** Zone to the color of the project bound to it, where it has a `.hued`. */
  zoneColors: Record<string, string>
  /** The zones held at the top of the wall, each to when it was pinned. */
  pinnedZones: Record<string, number>
  /** What each zone overrides about itself. Most zones have no entry. */
  zoneSettings: Record<string, ZoneSettings>
  /** Sets one zone's overrides. A field passed as null goes back to
   *  inheriting; a field left out is untouched. Nothing is held optimistically
   *  — the daemon answers with the message every wall reads. */
  setZoneSettings: (zone: string, patch: ZonePatch) => void
  ttlMs: number
  /** Sets how long an artifact lives from now on. The daemon answers with the
   *  `ttl` message every wall reads, so nothing is held optimistically here. */
  setTtlMs: (ms: number) => void
  /** Add to Date.now() to get the daemon's clock. Keeps decay server-anchored. */
  clockOffset: number
  connected: boolean
  /** Whether the daemon is running older code than is on disk. False until
   *  both have been heard from, and always in demo mode, where there is no
   *  daemon at all. */
  daemonStale: boolean
  /** What the wall holds on disk against its cap. Null until the daemon has said. */
  disk: Disk | null
  /** The last arrival whose level asks to be opened on sight. Held rather than
   *  fired so a wall that was closed does not open a queue of them at once —
   *  only the newest is still worth looking at. */
  announce: WallItem | null
  /** Sounds the daemon has played that the wall has not yet explained, oldest
   *  first. A toast exists for as long as its entry does. */
  alerts: Alert[]
  dismissAlert: (id: string) => void
}

/** How often to ask the daemon what its code on disk looks like. A commit is
 *  the only thing that moves it, and the chip is a nudge, not an alarm. */
const CODE_POLL_MS = 30_000

/** More than this and the newest sound is what matters; the rest have been
 *  heard and not read, and a column of them explains nothing. */
const ALERTS_SHOWN = 4

export function useWall(): Wall {
  const [items, setItems] = useState<WallItem[]>([])
  const [zoneColors, setZoneColors] = useState<Record<string, string>>({})
  const [pinnedZones, setPinnedZones] = useState<Record<string, number>>({})
  const [zoneSettings, holdZoneSettings] = useState<Record<string, ZoneSettings>>({})
  const [ttlMs, setTtlMs] = useState(300_000)
  const [connected, setConnected] = useState(false)
  const [daemonBuild, setDaemonBuild] = useState<Build | null>(null)
  const [disk, setDisk] = useState<Disk | null>(null)
  const [daemonCode, setDaemonCode] = useState<Build | null>(null)
  const [announce, setAnnounce] = useState<WallItem | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const clockOffset = useRef(0)
  const dismissAlert = useCallback(
    (id: string) => setAlerts((prev) => prev.filter((a) => a.id !== id)),
    [],
  )

  const postZone = useCallback((zone: string, patch: ZonePatch) => {
    actions.setZoneSettings(zone, patch)
  }, [])

  const postTtl = useCallback((ms: number) => {
    actions.setTtl(ms)
  }, [])

  useEffect(() => {
    if (__TRANSOM_DEMO__ || !connected) return
    const read = () =>
      fetch('/api/code')
        .then((res) => (res.ok ? (res.json() as Promise<Build>) : null))
        .then(setDaemonCode, () => {})
    void read()
    const timer = setInterval(read, CODE_POLL_MS)
    return () => clearInterval(timer)
  }, [connected])

  useEffect(
    () =>
      subscribe({
        connected: setConnected,
        message: (msg) => {
          if (msg.type === 'snapshot') {
            clockOffset.current = msg.now - Date.now()
            setTtlMs(msg.ttlMs)
            setItems(msg.items)
            setZoneColors(msg.zoneColors ?? {})
            setPinnedZones(msg.pinnedZones ?? {})
            holdZoneSettings(msg.zoneSettings ?? {})
            setDaemonBuild(msg.build ?? null)
            setDisk(msg.disk ?? null)
          } else if (msg.type === 'disk') {
            setDisk(msg.disk)
          } else if (msg.type === 'ttl') {
            setTtlMs(msg.ttlMs)
          } else if (msg.type === 'zoneColors') {
            setZoneColors(msg.zoneColors)
          } else if (msg.type === 'zoneSettings') {
            holdZoneSettings((prev) => {
              // A zone back to inheriting everything leaves no entry, the shape
              // the snapshot has: `zoneSettings[zone]` is absent, never empty.
              if (Object.keys(msg.settings).length === 0) {
                const { [msg.zone]: _inherits, ...rest } = prev
                return rest
              }
              return { ...prev, [msg.zone]: msg.settings }
            })
          } else if (msg.type === 'zonePin') {
            setPinnedZones((prev) => {
              if (msg.pinnedAt === null) {
                const { [msg.zone]: _released, ...rest } = prev
                return rest
              }
              return { ...prev, [msg.zone]: msg.pinnedAt }
            })
          } else if (msg.type === 'arrive') {
            setItems((prev) => [...prev, msg.item])
            const level = msg.item.attention?.level
            if (level && ALERTS[level].lightbox) setAnnounce(msg.item)
          } else if (msg.type === 'alert') {
            setAlerts((prev) => [...prev.filter((a) => a.id !== msg.alert.id), msg.alert].slice(-ALERTS_SHOWN))
          } else if (msg.type === 'expire') {
            setItems((prev) => prev.filter((i) => i.id !== msg.id))
          } else if (msg.type === 'keep') {
            setItems((prev) =>
              prev.map((i) => {
                if (i.id !== msg.id) return i
                if (msg.keptAt === null) {
                  const { keptAt: _released, ...rest } = i
                  return rest
                }
                return { ...i, keptAt: msg.keptAt }
              }),
            )
          } else if (msg.type === 'dismiss') {
            // The item stays; only its flag goes.
            setItems((prev) =>
              prev.map((i) => {
                if (i.id !== msg.id) return i
                const { attention: _cleared, ...rest } = i
                return rest
              }),
            )
          } else if (msg.type === 'take') {
            // The one message that changes an item's pixels after it lands, so
            // the poster the daemon recomputed rides with it.
            setItems((prev) =>
              prev.map((i) =>
                i.id === msg.id ? { ...i, takes: [...(i.takes ?? []), msg.take], ...msg.poster } : i,
              ),
            )
          } else if (msg.type === 'markup') {
            setItems((prev) =>
              prev.map((i) => {
                if (i.id !== msg.id) return i
                if (msg.take === undefined) return { ...i, markup: msg.markup }
                return {
                  ...i,
                  takes: (i.takes ?? []).map((t) => (t.id === msg.take ? { ...t, markup: msg.markup } : t)),
                }
              }),
            )
          } else if (msg.type === 'reply') {
            setItems((prev) =>
              prev.map((i) => {
                if (i.id !== msg.id) return i
                if (msg.take === undefined) {
                  const { attention: _cleared, ...rest } = i
                  return { ...rest, reply: msg.reply }
                }
                const takes = (i.takes ?? []).map((t) =>
                  t.id === msg.take ? { ...t, reply: msg.reply } : t,
                )
                // A group stops asking only once nothing in it is waiting, so its
                // flag survives every answer but the last.
                const asking = takes.some((t) => t.question !== undefined && t.reply === undefined)
                const { attention, ...rest } = i
                return {
                  ...rest,
                  ...(asking && attention ? { attention } : {}),
                  takes,
                  ...(msg.poster ?? {}),
                }
              }),
            )
          }
        },
      }),
    [],
  )

  return {
    items,
    zoneColors,
    pinnedZones,
    zoneSettings,
    setZoneSettings: postZone,
    ttlMs,
    setTtlMs: postTtl,
    clockOffset: clockOffset.current,
    connected,
    disk,
    daemonStale: daemonBuild !== null && daemonCode !== null && !agree(daemonBuild, daemonCode),
    announce,
    alerts,
    dismissAlert,
  }
}
