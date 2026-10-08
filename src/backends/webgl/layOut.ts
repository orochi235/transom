import type { Rect } from 'windease'
import type { Arrangement, TransomChannels } from '@/arrangements/index.ts'
import { containerFor } from '@/arrangements/zones.ts'
import type { StackItem } from '@/model.ts'
import type { Plan } from '@/nav/Minimap.tsx'
import { baseCellsOf, unionOf, zoneCellsOf } from '@/nav/zone-cells.ts'
import type { StackParams } from '@/params.ts'
import type { useCardTextures } from '@/backends/webgl/useCardTextures.ts'
import type { WallState } from '@/backends/webgl/useWallState.ts'

/** The plan view is a diagram, not an animation: republishing it a few times a
 *  second keeps React out of the frame loop. */
const PLAN_MS = 250

export function layOut({
  s,
  arrangement,
  params,
  textures,
  model,
  zoneFor,
  current,
  now,
  onPlan,
  onOffWall,
}: {
  s: WallState
  arrangement: Arrangement
  params: StackParams
  textures: ReturnType<typeof useCardTextures>
  model: StackItem[]
  zoneFor: Map<string, string>
  current: WallState['latest']['current']
  now: number
  onPlan: (plan: Plan) => void
  onOffWall: (count: number) => void
}) {
  const { zoneNamesRef, setZoneNames, cells, bases, stream, streamBox, offWallRef } = s
  const { revealed, reveal, planAt, cardsByZone, zoneCounts } = s
  const result = arrangement.strategy.layout({
    items: model,
    container: containerFor(
      zoneNamesRef.current.length,
      window.innerWidth / window.innerHeight,
      params.zoneGrid,
    ),
    state: undefined,
    // `project` keeps the held cells the wall has always had, so the
    // default order is the one nobody asked to change. The other two keys
    // are a reordering by definition, and take the cells the sort implies.
    // A pin is a reordering asked for out loud, so it takes the given cells
    // under `project` too — otherwise the grid hands every zone the slot it
    // already had and the pin reaches nothing.
    options: {
      now,
      zones:
        current.sort !== 'project' || current.heldZones.size > 0 ? 'given' : 'held',
    },
  })

  const channels = (result.channels ?? new Map()) as Map<string, TransomChannels>
  const wantLod = new Map<string, number>()
  for (const [id, ch] of channels) wantLod.set(id, ch.lod ?? 0)
  textures.sync(wantLod)

  // A flat wall has no zone geometry, and every piece of zone chrome — the
  // labels, the counts, the plan, the cursor — is drawn from these, so
  // leaving them empty is what takes it all away.
  const flat = !!arrangement.flat
  const placedRects = result.placements as Map<string, Rect>
  cells.current = flat ? new Map() : zoneCellsOf(placedRects, zoneFor)
  bases.current = flat ? new Map() : baseCellsOf(placedRects, zoneFor)
  stream.current = flat ? [...placedRects.keys()] : []
  streamBox.current = flat ? unionOf([...placedRects.values()]) : null
  const off = flat ? (result.unplaced?.length ?? 0) : 0
  if (off !== offWallRef.current) {
    offWallRef.current = off
    onOffWall(off)
  }

  if (revealed.current < 1) {
    // The front of every pile draws at the top tier, so counting that tier is
    // counting the fronts without threading rank down here.
    const frontEdge = params.lod.tiers[0]?.edge ?? 0
    let fronts = 0
    let ready = 0
    for (const [id, edge] of wantLod) {
      if (edge !== frontEdge) continue
      fronts++
      if (textures.textureFor(id)) ready++
    }
    revealed.current = reveal.current({
      now: Date.now(),
      fronts,
      ready,
      holdMs: params.lod.revealHoldMs,
      fadeMs: params.lod.revealFadeMs,
    })
  }

  const tick = performance.now()
  if (tick - planAt.current > PLAN_MS) {
    planAt.current = tick
    onPlan({ cells: [...bases.current].map(([zone, box]) => ({ zone, box })) })
  }

  const names = [...cells.current.keys()]
  const sameZones =
    names.length === zoneNamesRef.current.length &&
    names.every((n, i) => zoneNamesRef.current[i] === n)
  if (!sameZones) {
    zoneNamesRef.current = names
    setZoneNames(names)
  }

  // Ordered by depth rather than by arrival: an arrangement that puts every
  // card at z 0 keeps insertion order, and the stack's ranks sort themselves.
  const ranked = new Map<string, { id: string; z: number }[]>()
  for (const [id, rect] of flat ? [] : placedRects) {
    const zone = zoneFor.get(id)
    if (zone === undefined) continue
    const list = ranked.get(zone)
    if (list) list.push({ id, z: rect.z })
    else ranked.set(zone, [{ id, z: rect.z }])
  }
  cardsByZone.current = new Map(
    [...ranked].map(([zone, list]) => [zone, list.sort((a, b) => b.z - a.z).map((e) => e.id)]),
  )
  // The front of each pile, which is the only card that wears an age chip:
  // a rank behind it is mostly hidden by the card in front of it.
  const fronts = new Set<string>()
  for (const list of cardsByZone.current.values()) if (list[0]) fronts.add(list[0])
  // Nothing on a flat wall is buried, so every card is a front.
  for (const id of stream.current) fronts.add(id)
  zoneCounts.current = new Map(
    [...cardsByZone.current].map(([zone, list]) => [zone, list.length]),
  )
  return { result, channels, tick, fronts }
}
