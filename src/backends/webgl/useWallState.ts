import { useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'
import type { Rect } from 'windease'
import type { Pose } from '@/camera/frame.ts'
import type { Move } from '@/camera/move.ts'
import type { Placement } from '@/nav/ladder.ts'
import { createReveal } from '@/textures/reveal.ts'
import type { Looks } from '@/backends/webgl/useLooks.ts'
import type { WallProps } from '@/backends/webgl/types.ts'

type Mirrored = Pick<
  WallProps,
  | 'items'
  | 'ttlMs'
  | 'clockOffset'
  | 'sort'
  | 'dimmed'
  | 'connected'
  | 'arrangement'
  | 'view'
  | 'listed'
  | 'params'
  | 'onBackOff'
  | 'backedOff'
> & {
  heldZones: Set<string>
  flagged: Looks['flagged']
  camera: THREE.Camera
}

export function useWallState({
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
}: Mirrored) {
  const meshes = useRef(new Map<string, THREE.Mesh>())
  const flaggedRef = useRef(flagged)
  flaggedRef.current = flagged
  /** The flagged artifact under the pointer, badge included. */
  const hovered = useRef<string | null>(null)
  const latest = useRef({ items, ttlMs, clockOffset, sort, dimmed, heldZones, connected })
  latest.current = { items, ttlMs, clockOffset, sort, dimmed, heldZones, connected }
  const cells = useRef<Map<string, Rect>>(new Map())
  /** Each pile's front card. The zone chrome is drawn on this rather than on
   *  the drawn union, so a tall pile does not outline more of the wall than its
   *  neighbor; the camera still frames the union, which is what is drawn. */
  const bases = useRef<Map<string, Rect>>(new Map())
  /** Each zone's label sprite, filled by the overlay that draws them. */
  const zoneLabels = useRef<Map<string, THREE.Object3D>>(new Map())
  const zoneById = useRef<Map<string, string>>(new Map())
  const move = useRef<Move | null>(null)
  const pose = useRef<Pose>({ x: 0, y: 0, distance: 2, halfHeight: 0.5 })
  /** The camera the plate hunt projects through: the live one's twin, posed
   *  where the current move lands rather than where it is mid-ease. Held as
   *  the base class because either projection can be live, and three's
   *  `copy` is typed per subclass — the clone is whichever kind it copied. */
  const seekCamera = useMemo<THREE.Camera>(() => camera.clone(), [camera])

  const [live, setLive] = useState<string[]>([])
  const liveRef = useRef<string[]>([])
  const reveal = useRef(createReveal())
  const revealed = useRef(0)
  const planAt = useRef(0)
  const dragged = useRef(false)
  const [zoneNames, setZoneNames] = useState<string[]>([])
  const zoneNamesRef = useRef<string[]>([])
  /** Each pile front to back, so the arrows can page it from the lightbox. */
  const cardsByZone = useRef<Map<string, string[]>>(new Map())
  /** How many artifacts each zone holds, for the count chip on its corner. */
  const zoneCounts = useRef<Map<string, number>>(new Map())
  /** A flat arrangement's cards in its own order, newest first — what the
   *  arrows page when there are no piles — and the box they cover. */
  const stream = useRef<string[]>([])
  const streamBox = useRef<Rect | null>(null)
  const offWallRef = useRef(0)
  const flatRef = useRef(!!arrangement.flat)
  flatRef.current = !!arrangement.flat
  /** The deepest z each pile reaches, so its backdrop can sit behind it. */
  const viewRef = useRef(view)
  viewRef.current = view
  const listedRef = useRef(listed)
  listedRef.current = listed
  /** Where each plate has been told to sit, as an offset in its own card's
   *  plane. Held between solves so the plate stays put while the grid is stale. */
  const plateAt = useRef(new Map<string, { dx: number; dy: number; welded: boolean }>())
  /** Which side of its pile each zone's group stands on, so the next solve
   *  can price leaving it. */
  const groupAt = useRef(new Map<string, Placement>())
  /** Where each plate actually is, and how fast, as the spring drives it
   *  toward the spot above. Separate from the target so a plate that has just
   *  changed its mind travels rather than teleports. */
  const plateMotion = useRef(new Map<string, { x: number; y: number; vx: number; vy: number }>())
  const seekAt = useRef(0)

  /** The rank of the card under a live drag, or null. Read by the wheel. */
  const movingRank = useRef<number | null>(null)
  const stepDrag = useRef(params.nav.dragCardSetsStep)
  stepDrag.current = params.nav.dragCardSetsStep
  /** A click on a zone's cell, held back for DOUBLE_MS in case it turns out to
   *  be the first half of a double. */
  const pendingZone = useRef<number | null>(null)
  const backOff = useRef(onBackOff)
  backOff.current = onBackOff
  const backedOffRef = useRef(backedOff)
  backedOffRef.current = backedOff
  const paramsRef = useRef(params)
  paramsRef.current = params

  /**
   * How far the wall has slid along x, in world units, while the camera is not
   * fitting its width. A ref rather than state: it moves per frame under a drag
   * and the framing reads it on the next pass, so re-rendering on each step
   * would cost a React pass per pixel and change nothing else on screen.
   */
  const panX = useRef(0)

  return {
    meshes,
    flaggedRef,
    hovered,
    latest,
    cells,
    bases,
    zoneLabels,
    zoneById,
    move,
    pose,
    seekCamera,
    live,
    setLive,
    liveRef,
    reveal,
    revealed,
    planAt,
    dragged,
    zoneNames,
    setZoneNames,
    zoneNamesRef,
    cardsByZone,
    zoneCounts,
    stream,
    streamBox,
    offWallRef,
    flatRef,
    viewRef,
    listedRef,
    plateAt,
    groupAt,
    plateMotion,
    seekAt,
    movingRank,
    stepDrag,
    pendingZone,
    backOff,
    backedOffRef,
    paramsRef,
    panX,
  }
}

export type WallState = ReturnType<typeof useWallState>
