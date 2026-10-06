import { useEffect, useMemo, useRef, useState } from 'react'
import { actions } from '@/actions.ts'
import { arrangements as registry, arrangementsFor } from '@/arrangements/index.ts'
import { WebglBackend } from '@/backends/WebglBackend.tsx'
import { ParallaxModal } from '@/ParallaxModal.tsx'
import { Prefs } from '@/Prefs.tsx'
import { ZoneConfig } from '@/ZoneConfig.tsx'
import { layoutKeyOf } from '@/params.layout.ts'
import { defaultParams, embedParams } from '@/params.ts'
import { loadParams, saveParams } from '@/params.store.ts'
import { useBandState } from '@/nav/useBandState.ts'
import { Toasts } from '@/Toasts.tsx'
import { applyColors } from '@/theme.ts'
import { stackFor } from '@/typeface.ts'
import { useWall } from '@/useWall.ts'
import { tintsFor } from '@/zone-settings.ts'

const ARRANGEMENT_COUNT = registry.length

/** The demo framed inside another page. It shares an origin with the full
 *  demo, so it neither reads nor writes the stored tuning. */
const EMBEDDED = __TRANSOM_DEMO__ && new URLSearchParams(location.search).has('embed')

/** A stored arrangement name back to its place in the cycle. An unknown name —
 *  a retired arrangement, or one from a build that had it — is the first. */
const indexOf = (name: string | null): number => {
  const at = registry.findIndex((a) => a.name === name)
  return at === -1 ? 0 : at
}

/** The name `[` or `]` lands on, wrapping either way. */
const nameAt = (at: number): string =>
  registry[((at % ARRANGEMENT_COUNT) + ARRANGEMENT_COUNT) % ARRANGEMENT_COUNT].name


export function App() {
  const {
    items,
    zoneColors,
    pinnedZones,
    zoneSettings,
    setZoneSettings,
    ttlMs,
    setTtlMs,
    clockOffset,
    connected,
    daemonStale,
    disk,
    announce,
    alerts,
    dismissAlert,
  } = useWall()
  const [band, setBand] = useBandState()
  const [prefs, setPrefs] = useState(false)
  /** The zone whose own sheet is open, or null. */
  const [configuring, setConfiguring] = useState<string | null>(null)
  // A zone's own color over the project's, so everything below reads one map
  // and never learns there is an override.
  const tints = useMemo(() => tintsFor(zoneColors, zoneSettings), [zoneColors, zoneSettings])
  // Lazy: reading storage on every render would be wasted, and the tuning
  // pass is the whole reason the panel exists — losing it on reload defeats it.
  const [params, setParams] = useState(() =>
    EMBEDDED ? embedParams : loadParams(defaultParams),
  )
  // Every arrangement closes over its params, so a change rebuilds them
  // and resets their allocators — one frame of snapping, the same contract
  // every cache here already honors. Keyed on the layout half alone so that
  // turning the camera, which no strategy reads, does not reshuffle the piles.
  const layoutKey = layoutKeyOf(params)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- layoutKey is params, minus the display half
  const arrangements = useMemo(() => arrangementsFor(params), [layoutKey])

  // Only a tab that can edit writes, and only once it actually has. A mount
  // write is what turns a read this build cannot parse into a permanent loss:
  // loadParams falls back to the defaults, and the effect then saves them over
  // the stored set. A second wall on another monitor no longer clobbers the
  // tuned one either, since it has no panel to tune with.
  const loaded = useRef(params)
  useEffect(() => {
    if (!EMBEDDED && params !== loaded.current) saveParams(params)
  }, [params])

  useEffect(() => {
    applyColors(params.colors, document.documentElement)
  }, [params.colors])

  useEffect(() => {
    document.documentElement.style.setProperty('--chrome-face', stackFor(params.typeface.chrome))
  }, [params.typeface.chrome])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Chrome opens its own settings on ⌘, unless the page cancels it first.
      if (e.key === ',' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        return setPrefs((open) => !open)
      }
      if (e.key !== '[' && e.key !== ']') return
      const step = e.key === ']' ? 1 : -1
      setBand((was) => ({ arrangement: nameAt(indexOf(was.arrangement) + step) }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setBand])

  const arrangement = arrangements[indexOf(band.arrangement)]
  if (!arrangement) return null

  return (
    <>
      <WebglBackend
        items={items}
        arrangement={arrangement}
        ttlMs={ttlMs}
        clockOffset={clockOffset}
        params={params}
        onParams={setParams}
        zoneColors={tints}
        pinnedZones={pinnedZones}
        zoneSettings={zoneSettings}
        onConfigureZone={setConfiguring}
        onPrefs={() => setPrefs(true)}
        announce={announce}
        connected={connected}
        stale={daemonStale}
        disk={disk}
        band={band}
        onBand={setBand}
      />
      <ParallaxModal allowParallax={params.general.parallax} />
      <Toasts alerts={alerts} onDismiss={dismissAlert} />
      {configuring !== null && (
        <ZoneConfig
          zone={configuring}
          settings={zoneSettings[configuring] ?? {}}
          hued={zoneColors[configuring]}
          count={items.filter((i) => i.zone === configuring).length}
          pinned={configuring in pinnedZones}
          wall={{
            backdrop: params.zones.backdrop,
            hatchSpacing: params.zones.hatchSpacing,
            hatchPeriod: params.zones.hatchPeriod,
            hatchAngleDeg: params.zones.hatchAngleDeg,
            ttlMs,
          }}
          look={params.prefs}
          allowParallax={params.general.parallax}
          onChange={(patch) => setZoneSettings(configuring, patch)}
          onPin={(on) => actions.pinZone(configuring, on)}
          onExpire={() => {
            actions.expireZone(configuring)
            setConfiguring(null)
          }}
          onClose={() => setConfiguring(null)}
        />
      )}
      {prefs && (
        <Prefs
          params={params}
          onChange={setParams}
          ttlMs={ttlMs}
          onTtl={setTtlMs}
          onClose={() => setPrefs(false)}
        />
      )}
    </>
  )
}
