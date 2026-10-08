import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { ZoneOverlay } from '@/backends/ZoneOverlay.tsx'
import { stackFor } from '@/typeface.ts'
import { zoneOf } from '@/view-state.ts'
import type { WallProps } from '@/backends/webgl/types.ts'
import { useBounds } from '@/backends/webgl/useBounds.ts'
import { useCardTextures } from '@/backends/webgl/useCardTextures.ts'
import { useChrome } from '@/backends/webgl/useChrome.ts'
import { useFraming } from '@/backends/webgl/useFraming.ts'
import { useLooks } from '@/backends/webgl/useLooks.ts'
import { usePick } from '@/backends/webgl/usePick.ts'
import { usePointer } from '@/backends/webgl/usePointer.ts'
import { useWake } from '@/backends/webgl/useWake.ts'
import { useWallFrame } from '@/backends/webgl/useWallFrame.ts'
import { useWallKeys } from '@/backends/webgl/useWallKeys.ts'
import { useWallState } from '@/backends/webgl/useWallState.ts'
import { useWheel } from '@/backends/webgl/useWheel.ts'

/** One quad per item. Ranks past the fade get no texture and draw flat. */
export function Wall({
  items,
  arrangement,
  ttlMs,
  clockOffset,
  sort,
  params,
  onParams,
  zoneColors,
  pinnedZones,
  zoneSettings,
  view,
  dispatch,
  onPlan,
  onOffWall,
  onMenu,
  onPrefs,
  dimmed,
  listed,
  onDelete,
  connected,
  sidebarInset,
  topInset,
  backedOff,
  onBackOff,
  showBounds,
}: WallProps) {
  /** The zone the arrows are pointing at from the wall, or null for a cursor
   *  that has not been shown yet. Not the view: pointing at a pile is not
   *  going to it, and the camera stays where it is until Enter says so. */
  const [cursor, setCursor] = useState<string | null>(null)
  const { camera } = useThree()
  const { wake, awakeUntil } = useWake(params)
  const labelFamily = stackFor(params.typeface.label)
  const looks = useLooks(items, params, zoneColors)
  const { fontsReady, flagged, huedColors } = looks
  const textures = useCardTextures(items, params, wake)
  const chrome = useChrome()
  const { geometry, edges, badges, chips, pins, plays, asks, leaders } = chrome

  // A set because the order the zones were pinned in is not what sorts them;
  // only whether each is held.
  const heldZones = useMemo(() => new Set(Object.keys(pinnedZones)), [pinnedZones])
  const s = useWallState({
    items,
    ttlMs,
    clockOffset,
    sort,
    dimmed,
    heldZones,
    connected,
    arrangement,
    view,
    listed,
    params,
    onBackOff,
    backedOff,
    flagged,
    camera,
  })
  const { meshes, live, bases, zoneLabels, zoneNames, zoneCounts } = s

  // Each of these is a reason to draw, not an input the effect reads.
  useEffect(() => wake(), [wake, items, params, view, sort, dimmed, zoneColors, zoneSettings, pinnedZones, connected, cursor, fontsReady, backedOff, showBounds])

  const { bounds, boundsLines, draw: drawBounds } = useBounds()
  const { retarget, panBy } = useFraming({
    s,
    bounds,
    params,
    backedOff,
    sidebarInset,
    topInset,
    cursor,
    wake,
  })
  const act = usePick(s, badges, dispatch, onPrefs)
  usePointer({ s, act, panBy, onParams, onMenu, dispatch })
  useWheel({ s, act, panBy, params, onParams, dispatch })
  useWallKeys({ s, cursor, setCursor, dispatch, onDelete })
  useWallFrame({
    s,
    chrome,
    looks,
    textures,
    drawBounds,
    retarget,
    awakeUntil,
    params,
    view,
    arrangement,
    dispatch,
    onPlan,
    onOffWall,
    dimmed,
    showBounds,
    sidebarInset,
    topInset,
  })

  // Held by reference so a plan republish reconciles nothing: React skips a
  // child whose element is the one it already rendered.
  const quads = useMemo(
    () =>
      live.map((id) => (
        <mesh
          key={id}
          geometry={geometry}
          ref={(m) => {
            if (m) {
              // What the raycast reads back: the pick has to name a card, and
              // the alternative is a reverse scan of every mesh on the wall.
              m.userData.transomId = id
              meshes.current.set(id, m)
            } else meshes.current.delete(id)
          }}
        >
          <meshBasicMaterial toneMapped={false} />
          {/* Always mounted, shown per frame: the attention halo reuses this
              line, so its presence cannot depend on the diagnostic toggle. */}
          <primitive object={edges.for(id)} />
        </mesh>
      )),
    [live, geometry, edges],
  )

  return (
    <group>
      {quads}
      {live.map((id) => {
        const held = badges.byId.get(id)
        return held ? <primitive key={`badge-${id}`} object={held.plate} /> : null
      })}
      {live.map((id) => {
        const held = chips.byId.get(id)
        return held ? <primitive key={`chip-${id}`} object={held.plate} /> : null
      })}
      {live.map((id) => {
        const held = pins.byId.get(id)
        return held ? <primitive key={`pin-${id}`} object={held.plate} /> : null
      })}
      {live.map((id) => {
        const held = plays.byId.get(id)
        return held ? <primitive key={`plays-${id}`} object={held.plate} /> : null
      })}
      {live.map((id) => {
        const held = asks.byId.get(id)
        return held ? <primitive key={`asks-${id}`} object={held.plate} /> : null
      })}
      {[...leaders].map(([level, line]) => (
        <primitive key={`leader-${level}`} object={line} />
      ))}
      <primitive object={boundsLines.outer} />
      <primitive object={boundsLines.inner} />
      <ZoneOverlay
        cells={bases}
        counts={zoneCounts}
        chips={params.chips}
        zones={zoneNames}
        focus={zoneOf(view)}
        cursor={cursor}
        pinnedZones={heldZones}
        labelPicks={zoneLabels}
        moveMs={params.camera.moveMs}
        settings={params.zones}
        zoneSettings={zoneSettings}
        colors={params.colors}
        hued={huedColors}
        family={labelFamily}
        fontsReady={fontsReady}
      />
    </group>
  )
}
