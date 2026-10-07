import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import * as THREE from 'three'
import type { Rect } from 'windease'
import { actions } from '@/actions.ts'
import { posterTake, groupBadge } from '@shared/groups.ts'
import { ASK_GLYPH, cornerChip, replyWords } from '@/asks.ts'
import type { Arrangement, TransomChannels } from '@/arrangements/index.ts'
import { containerFor, frontSlotOf, gridCells } from '@/arrangements/zones.ts'
import { frameExtent, framePose, type Pose } from '@/camera/frame.ts'
import { type Move, poseAt } from '@/camera/move.ts'
import { orbitOffset } from '@/camera/orbit.ts'
import { clampPan, revealPan } from '@/camera/pan.ts'
import { Lightbox } from '@/Lightbox.tsx'
import { ResetView } from '@/ResetView.tsx'
import { homeCamera } from '@/camera/home.ts'
import { CardMenu, type MenuAt } from '@/menu/CardMenu.tsx'
import { targetOf, type Action } from '@/menu/items.ts'
import { Sidebar } from '@/Sidebar.tsx'
import { usePersistedFlag } from '@/usePersistedFlag.ts'
import { TopBar } from '@/TopBar.tsx'
import { copyArtifact } from '@/menu/copy.ts'
import { keptBy, resolve, sameIds, type Filter } from '@/nav/time-filter.ts'
import { fakeFlags, type FakeFlag } from '@/debug-flags.ts'
import { Sky } from '@/backends/Sky.tsx'
import { ZoneOverlay } from '@/backends/ZoneOverlay.tsx'
import { ago } from '@/age.ts'
import { toStackItems } from '@/model.ts'
import { keptByKind, type KindKey } from '@/nav/kind-filter.ts'
import { inZoneOrder, zoneOrder, type SortKey } from '@/nav/sort.ts'
import type { BandState } from '@/nav/band-state.ts'
import { Minimap, type Plan } from '@/nav/Minimap.tsx'
import { Axes } from '@/nav/Axes.tsx'
import { boxPositions, createLoop, loopPositions, setResolution } from '@/backends/fatLines.ts'
import { CHROME_ORDER } from '@/backends/order.ts'
import { badgeTexture } from '@/textures/badge.ts'
import { createChips } from '@/textures/chip.ts'
import { loadFaces, stackFor } from '@/typeface.ts'
import { LEVELS, type Level } from '@shared/attention.ts'
import { formatClock } from '@shared/duration.ts'
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { createGestureRail } from '@/nav/gesture.ts'
import {
  deletes,
  directionFor,
  isForAControl,
  opensIn,
  sortFor,
  togglesList,
} from '@/nav/keys.ts'
import { afterDelete, jumpFrom, pageFrom, readingOrder, streamFrom } from '@/nav/list.ts'
import { neighborOf } from '@/nav/neighbor.ts'
import { cardHit, zoneAt } from '@/nav/pick.ts'
import { liftedHex, liftedTint } from '@/nav/zone-tint.ts'
import { offscreen, type Box } from '@/nav/whitespace.ts'
import { ladder, SIDES, solve, type Card, type Group, type Placement, type PlateSize } from '@/nav/ladder.ts'
import { stepFromDrag } from '@/nav/step-drag.ts'
import { clickToward, stepToward } from '@/nav/step.ts'
import { baseCellsOf, unionOf, withHeadroom, zoneCellsOf } from '@/nav/zone-cells.ts'
import type { StackParams } from '@/params.ts'
import { createTextureManager } from '@/textures/manager.ts'
import { loadBitmap } from '@/textures/source.ts'
import { createReveal } from '@/textures/reveal.ts'
import {
  cardOf,
  depthOf,
  descend,
  hashOfView,
  reduceView,
  type ViewAction,
  viewFromHash,
  type ViewState,
  WALL,
  zoneOf,
} from '@/view-state.ts'
import { rampAt, rampOf, rampTo } from '@/ramp.ts'
import type { Disk, WallItem, ZoneSettings } from '@shared/protocol.ts'

type Props = {
  items: WallItem[]
  arrangement: Arrangement
  ttlMs: number
  clockOffset: number
  params: StackParams
  onParams: Dispatch<SetStateAction<StackParams>>
  /** Published by the daemon: a zone's project color, where it has a `.hued`. */
  zoneColors: Record<string, string>
  /** Published by the daemon: the zones held at the top of the wall, each to
   *  when it was pinned. */
  pinnedZones: Record<string, number>
  /** Published by the daemon: what each zone overrides about itself. */
  zoneSettings: Record<string, ZoneSettings>
  /** Opens the zone's own settings sheet, which lives above this backend. */
  onConfigureZone: (zone: string) => void
  /** Opens the wall's preferences, which live above this backend too. */
  onPrefs: () => void
  /** An arrival whose level asks to be opened the moment it lands. */
  announce: WallItem | null
  /** Whether the daemon is still on the other end of the socket. */
  connected: boolean
  /** Whether the daemon is running different code from this wall. A LaunchAgent
   *  daemon does not reload, so this is the only sign a feature is missing
   *  because the process predates it rather than because it is broken. */
  stale: boolean
  disk: Disk | null
  /** What the band is set to, restored from the last visit. Held above this
   *  backend because the arrangement is one of its fields and the cycle keys
   *  live up there. */
  band: BandState
  onBand: (patch: Partial<BandState> | ((was: BandState) => Partial<BandState>)) => void
}

type WallProps = Props & {
  /** The band's sort key. Reaches the layout as the order of the items, since
   *  zone order is the insertion order of the strategy's own `byZone`. */
  sort: SortKey
  view: ViewState
  dispatch: Dispatch<ViewAction>
  onPlan: (plan: Plan) => void
  /** How many artifacts a flat arrangement had no room for. */
  onOffWall: (count: number) => void
  /** A right-click, already resolved to what it was over. The pick lives in
   *  here with the raycaster; the menu is DOM and lives outside the canvas. */
  onMenu: (at: MenuAt) => void
  /** Excluded by the band's filters. Still drawn, still in rank — faded, so
   *  what was cut stays legible against what was kept. */
  dimmed: ReadonlySet<string>
  /** Whether ← and → in the lightbox carry on past a pile into the next. */
  listed: boolean
  /** Delete with a card open. The view has already moved off it. */
  onDelete: (id: string) => void
  /** Fraction of the canvas the sidebar covers. A ref, not a value: the framing
   *  reads it every frame and the panel opening must not re-render the wall. */
  sidebarInset: { current: number }
  topInset: { current: number }
  /** One step out past the wall, framed with `camera.zoomOutRoom` of extra room. */
  backedOff: boolean
  onBackOff: (on: boolean) => void
  /** Debug: draw the volume the camera can frame, and the default frame in it. */
  showBounds: boolean
}

/** The plan view is a diagram, not an animation: republishing it a few times a
 *  second keeps React out of the frame loop. */
const PLAN_MS = 250

/** How often an idle wall still draws. Ages, fades and the age chips move on
 *  the clock with nothing to wake the canvas, and none of them reads finer. */
const IDLE_MS = 1000

/** How far the scene turns per pixel dragged. */
const DEG_PER_PX = 0.25

/** Clear of its own card, so the plate never z-fights the border it sits on. */
/** Drawn as text, so it wears whatever color emoji font the system has. */
const PIN_GLYPH = '📌'

/** What a card wears when there is more to the artifact than the wall draws —
 *  an animation, a video, a mesh. The badge is the invitation to open the
 *  lightbox, which plays or turns it. */
const PLAYS_GLYPH = '▶'
const MESH_GLYPH = '⬡'
/** A card that stands for many pictures rather than one, with how far through
 *  them the poster is. Two sheets, because that is what a group is. */
const GROUP_GLYPH = '⧉'

const BADGE_LIFT = 0.002

/** Movement past this is an orbit; anything less is the click it looks like. */
const DRAG_SLOP_PX = 4

/** `PointerEvent.button` for the wheel pressed as a button. */
const MIDDLE_BUTTON = 1

/** How long a click on a zone's own cell waits to see whether a second one is
 *  coming. Only a bare cell waits: a card opens on the first click, and paying
 *  this on every card would be felt on every artifact on the wall. */
const DOUBLE_MS = 250

/** The corners of a unit quad, for turning a plane into a screen rectangle. */
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** A textured card takes no tint; the map is the color. */
const WHITE = new THREE.Color(0xffffff)

/** The framing slack for a rung, the last entry serving every rung past it. */
const marginFor = (margins: readonly number[], depth: number) =>
  margins[Math.min(depth, margins.length - 1)] ?? 1

/** One quad per item. Ranks past the fade get no texture and draw flat. */
function Wall({
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
  const meshes = useRef(new Map<string, THREE.Mesh>())
  /** The zone the arrows are pointing at from the wall, or null for a cursor
   *  that has not been shown yet. Not the view: pointing at a pile is not
   *  going to it, and the camera stays where it is until Enter says so. */
  const [cursor, setCursor] = useState<string | null>(null)
  const { gl, camera, invalidate } = useThree()
  // The canvas draws on demand. Whatever can start motion calls `wake`, which
  // keeps frames coming for as long as the longest animation it could start;
  // motion that runs longer than that keeps them coming from the frame itself.
  const holdMs = useRef(0)
  holdMs.current = Math.max(params.shoveMs, params.zoneGrid.moveMs, params.camera.moveMs) + 120
  const awakeUntil = useRef(0)
  const wake = useCallback(() => {
    awakeUntil.current = Math.max(awakeUntil.current, performance.now() + holdMs.current)
    invalidate()
  }, [invalidate])
  const cardEdges = params.overlay.cardEdges
  const cardEdgeColor = params.colors.cardEdge
  const labelFamily = stackFor(params.typeface.label)
  const badgeFamily = stackFor(params.typeface.badge)
  // Canvas text falls back silently for a face the document has not finished
  // loading, so everything drawn to a canvas is rebuilt once they are in.
  const [fontsReady, setFontsReady] = useState(false)
  useEffect(() => {
    let live = true
    void loadFaces().then(() => live && setFontsReady(true))
    return () => {
      live = false
    }
  }, [])

  const levelColors: Record<Level, string> = {
    look: params.colors.attentionLook,
    soon: params.colors.attentionSoon,
    urgent: params.colors.attentionUrgent,
    problem: params.colors.attentionProblem,
  }
  // Which artifacts are asking, and what their badges say. Off the items
  // rather than the channels: a level is a name and a note is a sentence,
  // and `TransomChannels` carries numbers.
  // A closed question keeps a badge that no longer asks: the question and
  // what it got, with no emphasis behind it.
  const flagged = useMemo(() => {
    const out = new Map<string, { level: Level; note?: string; inert?: true }>()
    for (const i of items) {
      if (i.attention) {
        out.set(i.id, { level: i.attention.level, ...(i.note ? { note: i.note } : {}) })
      } else if (i.question && i.reply) {
        const got = i.reply.status === 'answered' ? i.reply.text.split('\n')[0] : replyWords(i.reply)
        out.set(i.id, { level: 'look', note: `${i.question} → ${got}`, inert: true })
      }
    }
    return out
  }, [items])
  const blank = useMemo(() => new THREE.Color(params.colors.cardBlank), [params.colors.cardBlank])
  const huedCardEdge = params.zones.huedCardEdge
  // Parsed once per color rather than per card per frame.
  const huedMinLight = params.zones.huedMinLight
  const huedColors = useMemo(() => {
    const out = new Map<string, THREE.Color>()
    for (const [zone, css] of Object.entries(zoneColors)) {
      const color = liftedTint(css, huedMinLight)
      if (color) out.set(zone, color)
    }
    return out
  }, [zoneColors, huedMinLight])

  // Where a card's pixels are is the daemon's answer, carried on the item —
  // not a route rebuilt here, which the demo wall has no server to satisfy.
  // Through a ref so an arrival does not rebuild the whole texture manager.
  const urlById = useRef(new Map<string, string>())
  urlById.current = useMemo(() => new Map(items.map((i) => [i.id, i.url])), [items])

  const textures = useMemo(
    () =>
      createTextureManager<THREE.Texture>({
        budgetBytes: params.lod.budgetBytes,
        urlFor: (id) => urlById.current.get(id) ?? '',
        load: async (url, edge) => {
          const bitmap = await loadBitmap(url, edge)
          if (!bitmap) return null
          const tex = new THREE.Texture(bitmap as unknown as HTMLImageElement)
          tex.colorSpace = THREE.SRGBColorSpace
          tex.needsUpdate = true
          return { value: tex, bytes: edge * edge * 4 }
        },
        dispose: (tex) => tex.dispose(),
        onLoad: wake,
      }),
    [params.lod.budgetBytes, wake],
  )

  // A lost context invalidates every GPU handle; rebuilding from an empty store
  // is the only safe response, and the manager re-uploads next frame.
  useEffect(() => {
    const canvas = gl.domElement
    const onLost = (e: Event) => {
      e.preventDefault()
      textures.clear()
    }
    canvas.addEventListener('webglcontextlost', onLost)
    return () => canvas.removeEventListener('webglcontextlost', onLost)
  }, [gl, textures])

  useEffect(() => () => textures.clear(), [textures])

  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  // A unit square the card mesh's own scale stretches to the drawn image, so
  // the outline needs none of the position corrections the card needed.
  // One loop per card. The unit square is stretched by the card's own scale,
  // and the width stays in screen pixels regardless — which is the point of a
  // width slider.
  const edges = useMemo(() => {
    const byId = new Map<string, ReturnType<typeof createLoop>>()
    return {
      byId,
      for(id: string) {
        let line = byId.get(id)
        if (!line) {
          line = createLoop()
          line.geometry.setPositions(loopPositions(-0.5, -0.5, 0.5, 0.5))
          byId.set(id, line)
        }
        return line
      },
    }
  }, [])
  useEffect(
    () => () => {
      for (const line of edges.byId.values()) {
        line.geometry.dispose()
        line.material.dispose()
      }
      edges.byId.clear()
    },
    [edges],
  )

  const badges = useMemo(() => {
    const quad = new THREE.PlaneGeometry(1, 1)
    const byId = new Map<string, { plate: THREE.Mesh; key: string; w: number; h: number }>()
    return {
      quad,
      byId,
      /** Rebuilt only when what it draws changes, so a per-frame call is free. */
      sync(
        id: string,
        key: string,
        text: string,
        fill: string,
        ink: string,
        font: string,
        lineHeight: number,
        maxWidth: number,
      ) {
        let held = byId.get(id)
        if (!held) {
          // A plane rather than a sprite, so the badge lies in its artifact's
          // own plane and turns with the wall. A sprite always faces the
          // camera, which peeled it off the card as soon as the scene rotated.
          const plate = new THREE.Mesh(
            quad,
            // Signage, not scenery: it composites over the wall rather than
            // sorting into it, so a nearer pile cannot bury the thing that is
            // asking to be looked at.
            new THREE.MeshBasicMaterial({
              transparent: true,
              depthTest: false,
              depthWrite: false,
              toneMapped: false,
              side: THREE.DoubleSide,
            }),
          )
          plate.renderOrder = CHROME_ORDER
          // The badge is a shortcut to its own artifact, so it takes a pick.
          plate.userData.transomId = id
          plate.userData.transomBadge = true
          held = { plate, key: '', w: 0, h: 0 }
          byId.set(id, held)
        }
        if (held.key !== key) {
          const material = held.plate.material as THREE.MeshBasicMaterial
          material.map?.dispose()
          const { texture, width, height } = badgeTexture(
            text,
            fill,
            ink,
            font,
            lineHeight,
            maxWidth,
          )
          material.map = texture
          material.needsUpdate = true
          held.key = key
          held.w = width
          held.h = height
        }
        return held
      },
    }
  }, [])
  const chips = useMemo(() => createChips(), [])
  const chipRamp = useRef(rampOf(1))
  const pins = useMemo(() => createChips(), [])
  const plays = useMemo(() => createChips(), [])
  const asks = useMemo(() => createChips(), [])
  useEffect(() => () => chips.dispose(), [chips])
  useEffect(() => () => pins.dispose(), [pins])
  useEffect(() => () => plays.dispose(), [plays])
  useEffect(() => () => asks.dispose(), [asks])

  /** One line object per level rather than one per badge: a LineMaterial has a
   *  single color, and four draw calls is cheaper than one per flag. */
  const leaders = useMemo(() => {
    const byLevel = new Map<Level, LineSegments2>()
    for (const level of LEVELS) {
      const line = createLoop()
      line.material.depthTest = false
      line.material.depthWrite = false
      line.renderOrder = CHROME_ORDER
      byLevel.set(level, line)
    }
    return byLevel
  }, [])
  useEffect(
    () => () => {
      for (const line of leaders.values()) {
        line.geometry.dispose()
        line.material.dispose()
      }
    },
    [leaders],
  )

  useEffect(
    () => () => {
      for (const { plate } of badges.byId.values()) {
        const material = plate.material as THREE.MeshBasicMaterial
        material.map?.dispose()
        material.dispose()
      }
      badges.quad.dispose()
      badges.byId.clear()
    },
    [badges],
  )

  const flaggedRef = useRef(flagged)
  flaggedRef.current = flagged
  /** The flagged artifact under the pointer, badge included. */
  const hovered = useRef<string | null>(null)

  // A set because the order the zones were pinned in is not what sorts them;
  // only whether each is held.
  const heldZones = useMemo(() => new Set(Object.keys(pinnedZones)), [pinnedZones])
  const latest = useRef({ items, ttlMs, clockOffset, sort, dimmed, heldZones, connected })
  latest.current = { items, ttlMs, clockOffset, sort, dimmed, heldZones, connected }

  // Each of these is a reason to draw, not an input the effect reads.
  useEffect(() => wake(), [wake, items, params, view, sort, dimmed, zoneColors, zoneSettings, pinnedZones, connected, cursor, fontsReady, backedOff, showBounds])

  // The arrows move the cursor across a row that may be wider than the window,
  // so the row follows it rather than the cursor walking off the edge.
  useEffect(() => {
    if (params.camera.wallShows === undefined || cursor === null) return
    const cell = bases.current.get(cursor)
    const box = unionOf([...bases.current.values()])
    if (!cell || !box) return
    const halfWidth = pose.current.halfHeight * (window.innerWidth / window.innerHeight)
    panX.current = revealPan(panX.current, cell, box, halfWidth)
    wake()
  }, [cursor, params.camera.wallShows, wake])
  useEffect(() => {
    const events = ['pointermove', 'pointerdown', 'pointerup', 'wheel', 'keydown', 'resize'] as const
    for (const name of events) window.addEventListener(name, wake, { passive: true })
    return () => {
      for (const name of events) window.removeEventListener(name, wake)
    }
  }, [wake])
  useEffect(() => {
    const id = setInterval(invalidate, IDLE_MS)
    return () => clearInterval(id)
  }, [invalidate])

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

  // Retargeted every frame rather than only on a level change: the cells are
  // not known until the first layout runs, and zones arrive and leave under a
  // camera that is already parked. A new move only starts when the target has
  // actually moved, so a steady wall is not re-eased every frame.
  /** What the bounds overlay draws, in world space: the widest frame the camera
   *  can reach and the default one. Written by `retarget` at the wall rung. */
  const bounds = useRef<{ outer: ReturnType<typeof frameExtent>; inner: ReturnType<typeof frameExtent> } | null>(null)
  const boundsLines = useMemo(() => {
    const outer = createLoop()
    const inner = createLoop()
    for (const line of [outer, inner]) {
      line.material.depthTest = false
      line.material.depthWrite = false
      line.renderOrder = CHROME_ORDER
      line.material.linewidth = 1.5
    }
    outer.material.color.set(0xff40ff)
    inner.material.color.set(0x40ffff)
    return { outer, inner }
  }, [])
  useEffect(
    () => () => {
      for (const line of [boundsLines.outer, boundsLines.inner]) {
        line.geometry.dispose()
        line.material.dispose()
      }
    },
    [boundsLines],
  )

  const retarget = (depth: number, zone: string | null) => {
    const aspect = window.innerWidth / window.innerHeight
    // The front card of each pile, not the union of everything it draws. A
    // pile's deep ranks step past its cell and are allowed to run off the
    // screen behind it: framing them pulls the camera back until the fronts —
    // the only rank anyone reads — are small.
    // The room a spare cell reserves is framed as though a pile stood in it, or
    // the camera would pull straight back into the one occupied quarter and
    // `minCells` would change nothing you can see. Only while zones are short
    // of it: once there are enough, every cell is claimed and the fronts are
    // the whole grid already.
    const container = containerFor(zoneNamesRef.current.length, aspect, params.zoneGrid)
    const zones = zoneNamesRef.current
    const spare =
      !flatRef.current && zones.length < params.zoneGrid.minCells
        ? gridCells(params.zoneGrid.minCells, container, params.zoneGrid)
            .slice(zones.length)
            .map((cell) => frontSlotOf(cell, params))
        : []
    const wall = (flatRef.current ? streamBox.current : unionOf([...bases.current.values(), ...spare])) ?? {
      x: 0,
      y: 0,
      z: 0,
      w: aspect,
      h: 1,
    }
    const framed = !zone ? wall : (bases.current.get(zone) ?? wall)
    // A label hangs above its cell, so framing the cells alone crops it.
    const headroom =
      (params.zones.labels ? params.zones.labelSize * 1.6 : 0) + params.attention.badgeSize
    const box = withHeadroom(framed, headroom)
    const frameAt = (margin: number) =>
      framePose(box, {
        projection: params.camera.projection,
        fovDeg: params.camera.fovDeg,
        standoff: params.camera.standoff,
        aspect,
        margin,
        insetRight: sidebarInset.current,
        insetTop: topInset.current,
        // Only the wall rung holds a set width; every rung below frames one
        // cell, which is the thing being looked at rather than a view of many.
        showWidth: depth === 0 ? params.camera.wallShows : undefined,
      })
    const wallMargin = marginFor(params.camera.margins, 0)
    const target = frameAt(
      marginFor(params.camera.margins, depth) * (depth === 0 && backedOff ? params.camera.zoomOutRoom : 1),
    )
    if (depth === 0 && params.camera.wallShows !== undefined) {
      const held = clampPan(panX.current, box.w, target.halfHeight * aspect)
      panX.current = held
      target.x += held
    }
    if (depth === 0) {
      bounds.current = {
        outer: frameExtent(frameAt(wallMargin * params.camera.zoomOutRoom), aspect),
        inner: frameExtent(frameAt(wallMargin), aspect),
      }
    }

    const held = move.current?.to
    const moved =
      !held ||
      Math.abs(held.x - target.x) > 1e-3 ||
      Math.abs(held.y - target.y) > 1e-3 ||
      Math.abs(held.distance - target.distance) > 1e-3 ||
      Math.abs(held.halfHeight - target.halfHeight) > 1e-3
    if (!moved) return

    move.current = {
      from: { ...pose.current },
      to: target,
      startedAt: performance.now(),
      durationMs: params.camera.moveMs,
    }
  }

  /** Set by the pick when what it hit was flagged, read and cleared by the
   *  navigate that follows it. */
  const jumpTo = useRef<readonly string[] | null>(null)
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const zeroPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), [])

  /** The card the raycaster's current ray picks, its badge counting as the
   *  card. The base under the pointer owns the pick (`cardHit`). */
  const cardUnder = (): string | undefined => {
    const targets: THREE.Object3D[] = [...meshes.current.values()]
    for (const { plate } of badges.byId.values()) if (plate.visible) targets.push(plate)
    const point = new THREE.Vector3()
    const owner = raycaster.ray.intersectPlane(zeroPlane, point)
      ? zoneAt({ x: point.x, y: -point.y }, bases.current)
      : null
    const hit = cardHit(
      raycaster.intersectObjects(targets, false),
      (h) => zoneById.current.get(h.object.userData.transomId as string),
      owner,
    )
    return hit?.object.userData.transomId as string | undefined
  }

  /**
   * The full path under the pointer — the pile, plus the card if one is hit.
   * A card is a mesh and a pile is not: its footprint is hit-tested against the
   * cells behind, which answers for a pile with no cards in it and needs no
   * invisible plane fighting the pile's own depth for the pick.
   */
  const chainAt = (clientX: number, clientY: number): string[] => {
    const rect = gl.domElement.getBoundingClientRect()
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    )

    // A label draws over everything, depth test and all, so it takes the
    // pick where it overlaps a card: what is on top is what was clicked. Its
    // whole quad counts, which is the point — the gaps between the letters are
    // not holes.
    for (const [zone, sprite] of zoneLabels.current) {
      if (!sprite.visible) continue
      if (raycaster.intersectObject(sprite, false).length > 0) return [zone]
    }

    const id = cardUnder()
    const hitZone = id ? zoneById.current.get(id) : undefined
    if (id && hitZone) {
      // A card is a destination, not a rung: hitting one goes straight to its
      // artifact rather than spending the gesture descending a level at a time.
      // A pile's own footprint still steps, which is what reaches a zone. The
      // badge and the card it is welded to behave identically.
      jumpTo.current = [hitZone, id]
      return [hitZone, id]
    }

    const point = new THREE.Vector3()
    if (!raycaster.ray.intersectPlane(zeroPlane, point)) return []
    // The renderer is the only place that undoes windease's downward y.
    const zone = zoneAt({ x: point.x, y: -point.y }, cells.current)
    return zone ? [zone] : []
  }

  /**
   * The artifact under the pointer, or null — what the cursor reads, and what
   * a click would open. A badge counts as part of its own artifact's frame: it
   * is welded to the border, so hitting it means hitting the card.
   *
   * Its own test rather than a read of `chainAt`, which answers with a path for
   * the whole wall and reports a zone where there is no card at all.
   */
  const hoverAt = (clientX: number, clientY: number): string | null => {
    if (meshes.current.size === 0) return null

    const rect = gl.domElement.getBoundingClientRect()
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    )
    return cardUnder() ?? null
  }

  /** One rung per gesture: across if the cursor is over another branch, down
   *  otherwise. Both the click and the wheel spend themselves through here. */
  const navigate = (chain: readonly string[]) => {
    const jump = jumpTo.current
    jumpTo.current = null
    if (jump) return void dispatch({ type: 'to', path: jump })
    const next = stepToward(viewRef.current.path, chain)
    if (next) dispatch({ type: 'to', path: next })
  }

  // Held by ref so the listeners below bind once and still see this render's
  // view: rebinding a wheel listener would drop the gesture rail's charge.
  /** How many ranks back a card sits in its own pile, or null if the pointer
   *  is not over one. The divisor that turns a dragged card into a per-rank
   *  step — and the front card, at rank 0, has nothing to spread over. */
  const rankAt = (clientX: number, clientY: number): number | null => {
    const chain = chainAt(clientX, clientY)
    const zone = chain[0]
    const id = chain[1]
    if (!zone || !id) return null
    const rank = cardsByZone.current.get(zone)?.indexOf(id) ?? -1
    return rank < 0 ? null : rank
  }

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

  /** Where a click lands, which at the wall is the zone's top card rather than
   *  a rung. Held beside `navigate` so the listener sees this render's view. */
  const clickAt = (chain: readonly string[]) =>
    clickToward(viewRef.current.path, chain, (zone) => cardsByZone.current.get(zone)?.[0])

  const act = useRef({ chainAt, navigate, hoverAt, rankAt, onPrefs, clickAt })
  act.current = { chainAt, navigate, hoverAt, rankAt, onPrefs, clickAt }
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
  const panBy = (dx: number) => {
    if (paramsRef.current.camera.wallShows === undefined) return
    panX.current += dx
    // `retarget` runs inside the frame loop and reads the ref, so waking the
    // loop is the whole of applying a pan.
    wake()
  }

  // Bound to the canvas, not to a mesh, so the empty space between piles turns
  // the scene. A press that never travels is a click, and picks a rung.
  useEffect(() => {
    const el = gl.domElement
    let active = false
    let last = { x: 0, y: 0 }
    /** The card being dragged, and where the drag began. Null while the
     *  gesture is an orbit. Mirrored into a ref so the wheel listener, which
     *  is bound elsewhere, can tell a depth nudge from a rung of navigation. */
    let moving: { rank: number; from: { x: number; y: number } } | null = null
    const setMoving = (next: typeof moving) => {
      moving = next
      movingRank.current = next?.rank ?? null
    }

    const onDown = (e: PointerEvent) => {
      // The wheel button moves a pile; the left button turns the wall and
      // picks. Two buttons rather than a modifier, so neither gesture has to
      // be held down wrong to find out which one it was.
      const wheelDown = e.button === MIDDLE_BUTTON
      if (e.button !== 0 && !wheelDown) return
      if (wheelDown) {
        // Suppresses the platform's own middle-click behavior — autoscroll on
        // Windows, paste on X11 — which would otherwise fire under the drag.
        e.preventDefault()
        if (!stepDrag.current) return
        const rank = act.current.rankAt(e.clientX, e.clientY)
        if (rank === null) return
        setMoving({ rank, from: { x: e.clientX, y: e.clientY } })
      }
      active = true
      dragged.current = false
      last = { x: e.clientX, y: e.clientY }
      el.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (!active) {
        // Every card is a control, so it says so under the pointer.
        // Only while idle: mid-orbit the cursor belongs to the drag.
        const over = act.current.hoverAt(e.clientX, e.clientY)
        hovered.current = over
        el.classList.toggle('scene--pointing', over !== null)
        return
      }
      const dx = e.clientX - last.x
      const dy = e.clientY - last.y
      if (!dragged.current && Math.hypot(dx, dy) < DRAG_SLOP_PX) return
      dragged.current = true
      last = { x: e.clientX, y: e.clientY }
      if (moving) {
        el.classList.add('scene--moving')
        // Against the drag's own origin rather than the last frame, so the
        // pile tracks the hand exactly instead of accumulating rounding.
        const dxTotal = e.clientX - moving.from.x
        const dyTotal = e.clientY - moving.from.y
        moving.from = { x: e.clientX, y: e.clientY }
        // The camera sees `2 * halfHeight` of world over the canvas's height,
        // whichever projection it is using.
        const worldPerPx = (pose.current.halfHeight * 2) / el.clientHeight
        onParams((p) => ({
          ...p,
          step: stepFromDrag({
            base: p.step,
            dxPx: dxTotal,
            dyPx: dyTotal,
            rank: moving!.rank,
            worldPerPx,
            yawDeg: p.camera.yawDeg,
            pitchDeg: p.camera.pitchDeg,
          }),
        }))
        return
      }
      // With the orbit off the same drag slides the row instead, which is the
      // only way left to reach a zone that is off the side.
      if (!paramsRef.current.nav.orbit) {
        if (paramsRef.current.camera.wallShows === undefined) return
        el.classList.add('scene--moving')
        panBy((-dx * (pose.current.halfHeight * 2)) / el.clientHeight)
        return
      }
      el.classList.add('scene--turning')
      onParams((p) => ({
        ...p,
        camera: {
          ...p.camera,
          // The camera orbits opposite the drag, so the scene follows the hand.
          yawDeg: clamp(p.camera.yawDeg - dx * DEG_PER_PX, -90, 90),
          pitchDeg: clamp(p.camera.pitchDeg + dy * DEG_PER_PX, -90, 90),
        },
      }))
    }
    const onUp = (e: PointerEvent) => {
      const turned = dragged.current
      const moved = moving !== null
      active = false
      setMoving(null)
      el.classList.remove('scene--turning')
      el.classList.remove('scene--moving')
      const over = act.current.hoverAt(e.clientX, e.clientY)
      hovered.current = over
      el.classList.toggle('scene--pointing', over !== null)
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (turned || moved || e.button !== 0) return
      const chain = act.current.chainAt(e.clientX, e.clientY)
      // At the wall a click opens the zone's top card outright, with no wait:
      // the pile it would otherwise step to is what the eye has already read.
      // Shift is the way back to a rung — and to the double-click below it.
      if (!e.shiftKey && depthOf(viewRef.current) === 0) {
        const target = act.current.clickAt(chain)
        return void (target && dispatch({ type: 'to', path: target }))
      }
      // One rung is a zone's own cell with no card under the pointer — the
      // backdrop. That is the one target that can be double-clicked, so it is
      // the one that waits.
      if (chain.length !== 1) return act.current.navigate(chain)
      if (pendingZone.current !== null) {
        window.clearTimeout(pendingZone.current)
        pendingZone.current = null
        return act.current.onPrefs()
      }
      pendingZone.current = window.setTimeout(() => {
        pendingZone.current = null
        act.current.navigate(chain)
      }, DOUBLE_MS)
    }

    // Chrome starts autoscroll from mousedown, not pointerdown, so the
    // suppression has to be on both.
    const onAux = (e: MouseEvent) => {
      if (e.button === MIDDLE_BUTTON) e.preventDefault()
    }
    // Only over the canvas: the lightbox is a real <img> so that the browser's
    // own menu can save and copy it, and taking that away would cost more than
    // the menu adds.
    const onContext = (e: MouseEvent) => {
      e.preventDefault()
      const chain = act.current.chainAt(e.clientX, e.clientY)
      onMenu({ target: targetOf(chain), x: e.clientX, y: e.clientY })
    }
    el.addEventListener('contextmenu', onContext)
    el.addEventListener('mousedown', onAux)
    el.addEventListener('auxclick', onAux)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    return () => {
      el.removeEventListener('contextmenu', onContext)
      el.removeEventListener('mousedown', onAux)
      el.removeEventListener('auxclick', onAux)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      if (pendingZone.current !== null) window.clearTimeout(pendingZone.current)
    }
  }, [gl, onParams, onMenu])

  // On the window rather than the canvas, so the gesture keeps working under
  // the lightbox, which covers it.
  useEffect(() => {
    const rail = createGestureRail(params.nav)
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element | null)?.closest?.('.params, .minimap, .prefs, .sidebar')) return
      // A trackpad pinch is a wheel event with ctrlKey set; left alone it zooms
      // the page instead of the wall.
      e.preventDefault()
      // Mid-drag the wheel is the third axis, not a rung. A drag reaches only
      // the two axes facing the camera, and orbiting to find the third is a
      // detour when the hand is already on the pile.
      // Scrolling with the wheel button held is the third axis: a drag reaches
      // only the two facing the camera, and orbiting to find the last one is a
      // detour when the hand is already on the pile.
      const rank = movingRank.current
      if (rank !== null) {
        const notches = e.deltaY / 100
        return void onParams((p) => ({
          ...p,
          step: { ...p.step, z: p.step.z - (notches * p.nav.dragDepthPerNotch) / Math.max(1, rank) },
        }))
      }
      // A two-finger sideways swipe slides the row. Taken before the rail so a
      // horizontal gesture never spends a rung, and only where the wall is
      // wider than the window — elsewhere deltaX is noise from a diagonal
      // scroll.
      if (paramsRef.current.camera.wallShows !== undefined && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const el = gl.domElement
        return panBy((e.deltaX * (pose.current.halfHeight * 2)) / el.clientHeight)
      }
      const step = rail.feed({ deltaY: e.deltaY, ctrlKey: e.ctrlKey }, e.timeStamp)
      if (!step) return
      // The wall has one more step out than the hierarchy: a little extra room.
      const atWall = depthOf(viewRef.current) === 0
      if (step === 'out') return atWall ? backOff.current(true) : dispatch({ type: 'out' })
      if (atWall && backedOffRef.current) return backOff.current(false)
      act.current.navigate(act.current.chainAt(e.clientX, e.clientY))
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [params.nav, dispatch, onParams])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isForAControl(e.target)) return
      if (e.key === 'Escape') {
        // The cursor is the innermost thing showing, so it is what Escape
        // takes away first.
        if (!zoneOf(viewRef.current) && cursor) return setCursor(null)
        return dispatch({ type: 'out' })
      }
      if (opensIn(e)) {
        const newest = stream.current[0]
        const next =
          flatRef.current && depthOf(viewRef.current) === 0
            ? newest && zoneById.current.get(newest) !== undefined
              ? [zoneById.current.get(newest)!, newest]
              : null
            : descend(viewRef.current.path, cursor, (zone) => cardsByZone.current.get(zone)?.[0])
        if (!next) return
        // Space scrolls a document, and the canvas is one as far as the
        // browser is concerned.
        e.preventDefault()
        setCursor(null)
        return dispatch({ type: 'to', path: next })
      }
      const zone = zoneOf(viewRef.current)
      const card = cardOf(viewRef.current)
      const order = () => (listedRef.current ? readingOrder(bases.current) : null)
      // What the band has filtered out is still on the wall, dimmed, and still
      // opens on a click — but paging runs past it, because arrowing through
      // the very cards you just excluded is not what narrowing the band asked
      // for.
      const skip = (id: string) => latest.current.dimmed.has(id)
      if (zone && card && deletes(e)) {
        e.preventDefault()
        // Moved first, or the expiry the daemon broadcasts prunes the view off
        // the card and the lightbox closes.
        const next = flatRef.current
          ? (streamFrom(card, 'right', stream.current, zoneById.current, skip) ??
            streamFrom(card, 'left', stream.current, zoneById.current, skip))
          : afterDelete({ zone, card }, cardsByZone.current, order(), skip)
        dispatch(next ? { type: 'to', path: next } : { type: 'out' })
        onDelete(card)
        return
      }

      const direction = directionFor(e)
      if (!direction) return
      if (!zone) {
        // At the wall the arrows drive the cursor rather than the camera: the
        // first press shows it on the first cell, every press after walks it.
        e.preventDefault()
        setCursor((at) => {
          const cells_ = cells.current
          if (!at || !cells_.has(at)) return [...cells_.keys()][0] ?? null
          return neighborOf(cells_, at, direction) ?? at
        })
        return
      }

      if (card) {
        // Inside a card left and right page the pile, and shift jumps to a
        // neighboring pile's front card in any direction.
        const sideways = direction === 'left' || direction === 'right'
        const next = flatRef.current
          ? sideways
            ? streamFrom(card, direction, stream.current, zoneById.current, skip)
            : null
          : e.shiftKey
            ? jumpFrom(zone, direction, cells.current, cardsByZone.current)
            : sideways
              ? pageFrom({ zone, card }, direction, cardsByZone.current, order(), skip)
              : null
        if (next) dispatch({ type: 'to', path: next })
        return
      }

      const next = neighborOf(cells.current, zone, direction)
      if (next) dispatch({ type: 'to', path: [next] })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch, cursor, onDelete])

  useFrame((_state, delta) => {
    const current = latest.current
    let springing = false
    const now = Date.now() + current.clockOffset
    const model = inZoneOrder(
      toStackItems(current.items, { now, ttlMs: current.ttlMs }, current.dimmed),
      zoneOrder(current.items, current.sort, now, current.heldZones),
    )
    const aspects = new Map(model.map((m) => [m.id, m.aspect]))
    // Real elapsed time, not the decay clock: keeping an artifact freezes how
    // it fades, and a chip that froze with it would report the wrong day.
    const bornAt = new Map(current.items.map((i) => [i.id, i.bornAt]))
    const pinned = new Set(current.items.filter((i) => i.keptAt).map((i) => i.id))
    // What the bottom-left badge reads. A video spends the runtime it
    // reported; an animation has none to spend and wears the bare glyph; a
    // mesh is not played at all and says so with its own.
    const playsText = new Map(
      current.items
        .filter((i) => i.frames || i.kind === 'video' || i.kind === 'mesh' || i.kind === 'group')
        .map((i) => [
          i.id,
          i.kind === 'group'
            ? `${GROUP_GLYPH} ${groupBadge(i)}`
            : i.kind === 'mesh'
              ? MESH_GLYPH
              : i.duration
                ? `${PLAYS_GLYPH} ${formatClock(i.duration)}`
                : PLAYS_GLYPH,
        ]),
    )
    // What a card wants, or wanted: a question waiting on a reply, or one that
    // has had one. A flag lapses and takes its plate with it, so the plate
    // cannot be the only sign that something is waiting -- and it is no sign at
    // all that something was, which is what the wall had no way to say.
    const asksText = new Map(
      current.items.flatMap((i) => {
        const chip = cornerChip(i)
        return chip ? [[i.id, chip] as const] : []
      }),
    )
    // A chip annotates its subject, so it shrinks when the camera closes on
    // one: at wall distance the pile is small and the note has to carry, and
    // zoomed in the card is what grew. Ramped over the camera's own move, so
    // the two arrive together instead of the chip snapping mid-flight.
    chipRamp.current = rampTo(
      chipRamp.current,
      zoneOf(viewRef.current) ? params.chips.shrink : 1,
      now,
      params.camera.moveMs,
    )
    const chipHeight =
      params.chips.size * rampAt(chipRamp.current, now, params.camera.moveMs)
    const zoneFor = new Map(model.map((m) => [m.id, m.zone]))
    zoneById.current = zoneFor

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

    // Which shelf slot each floating badge takes, the front of the pile first.
    // Assigned over the pile rather than per card, because the collision this
    // fixes is between two plates that belong to different cards.
    const shelf = new Map<string, number>()
    // The bottom plate of a pile whose front card is the flagged one is already
    // sitting on that card: it gets no line, because there is nothing for a
    // line to disambiguate. Only a plate that has had to climb needs one.
    const noLeader = new Set<string>()
    if (params.attention.float) {
      for (const ids of cardsByZone.current.values()) {
        let slot = 0
        for (const id of ids) {
          const flag = flagged.get(id)
          if (!flag?.note) continue
          if (!flag.inert && (channels.get(id)?.emphasis ?? 0) <= 0) continue
          if (slot === 0 && id === ids[0]) noLeader.add(id)
          shelf.set(id, slot++)
        }
      }
    }
    const leaderPoints = new Map<Level, number[]>()

    // Where the plates go, solved on a cadence rather than per frame: the
    // answer moves with the camera, and re-asking every frame would have them
    // crawling around the wall while it turns. Reads the meshes as the last
    // frame left them, which is a frame stale and invisible at this rate.
    const nowMs = performance.now()
    if (
      params.attention.seek &&
      params.attention.float &&
      nowMs - seekAt.current > params.attention.seekMs
    ) {
      seekAt.current = nowMs
      // Solved for the frame the camera is heading to, not the one it is
      // passing through: a spot picked mid-move is wrong the moment the move
      // lands, and the hysteresis then charges the plate for leaving it.
      seekCamera.copy(camera)
      applyPose(seekCamera, move.current?.to ?? pose.current, params.camera, window.innerWidth / window.innerHeight)
      seekCamera.updateMatrixWorld(true)
      // A plate lies in its card's plane or faces the camera; its spots are
      // measured in whichever frame it is drawn in.
      const plateFrame = (card: THREE.Object3D): THREE.Euler =>
        params.attention.billboard ? seekCamera.rotation : card.rotation
      // The ladder spaces plates along the pile in the plate's frame, so the
      // cards have to be measured in that frame too: a pile's depth step shows
      // up as a sideways step once the wall is turned and the plates are not.
      const unturn = seekCamera.quaternion.clone().invert()
      const inFrame = (card: THREE.Object3D): { x: number; y: number } =>
        params.attention.billboard ? card.position.clone().applyQuaternion(unturn) : card.position
      // The drawn size, without the pulse or the hover swell: a spot chosen
      // against a card mid-breath is a spot that moves with the breath.
      const halfOf = (mesh: THREE.Object3D): { hw: number; hh: number } => ({
        hw: ((mesh.userData.drawnW as number | undefined) ?? mesh.scale.x) / 2,
        hh: ((mesh.userData.drawnH as number | undefined) ?? mesh.scale.y) / 2,
      })
      // Chrome is not plate room: the band across the top and the sidebar,
      // when it is open, cover the canvas, and a plate under either is as
      // unreadable as one off the edge.
      const usable: Box = {
        x0: 0,
        y0: topInset.current,
        x1: 1 - sidebarInset.current,
        y1: 1,
      }
      const scratch = new THREE.Vector3()
      const boxOfPlane = (
        position: THREE.Vector3,
        rotation: THREE.Euler,
        hw: number,
        hh: number,
        dx: number,
        dy: number,
      ): Box => {
        let x0 = Infinity
        let y0 = Infinity
        let x1 = -Infinity
        let y1 = -Infinity
        for (const [ox, oy] of CORNERS) {
          scratch
            .set((ox as number) * hw + dx, (oy as number) * hh + dy, 0)
            .applyEuler(rotation)
            .add(position)
            .project(seekCamera)
          const sx = (scratch.x + 1) / 2
          const sy = (1 - scratch.y) / 2
          if (sx < x0) x0 = sx
          if (sx > x1) x1 = sx
          if (sy < y0) y0 = sy
          if (sy > y1) y1 = sy
        }
        return { x0, y0, x1, y1 }
      }

      // Every card on screen is ground a plate pays to stand on. A card nobody
      // can see occupies nothing: zoomed into one pile, most of the wall is
      // out of frame, and it must not read as busy edges.
      const obstacles: Box[] = []
      for (const mesh of meshes.current.values()) {
        if (!mesh.visible) continue
        const { hw, hh } = halfOf(mesh)
        const box = boxOfPlane(mesh.position, mesh.rotation, hw, hh, 0, 0)
        if (!offscreen(box, usable)) obstacles.push(box)
      }

      const toScreen = (x: number, y: number): { x: number; y: number } => {
        scratch.set(x, y, 0).project(seekCamera)
        return { x: (scratch.x + 1) / 2, y: (1 - scratch.y) / 2 }
      }
      // Every zone's cell, so a group standing on another zone's ground pays
      // for it even when nothing is drawn there.
      const cellBoxes: { zone: string; box: Box }[] = []
      for (const [zone, cell] of bases.current) {
        const a = toScreen(cell.x, -cell.y)
        const b = toScreen(cell.x + cell.w, -(cell.y + cell.h))
        cellBoxes.push({
          zone,
          box: {
            x0: Math.min(a.x, b.x),
            y0: Math.min(a.y, b.y),
            x1: Math.max(a.x, b.x),
            y1: Math.max(a.y, b.y),
          },
        })
      }

      // One group per pile, its plates in pile order, offered every side at
      // every reach — and welded when the pile's only plate is the front card's.
      const gap = params.attention.floatGap
      const groups: Group[] = []
      const members: { zone: string; ids: string[]; offsets: Map<string, { dx: number; dy: number }[]> }[] = []
      for (const [zone, ids] of cardsByZone.current) {
        // A plate drawn for the first time this frame has no size yet, and a
        // group solved around a zero-width plate would settle somewhere wrong.
        const plated = ids.filter(
          (id) => shelf.has(id) && meshes.current.has(id) && (badges.byId.get(id)?.w ?? 0) > 0,
        )
        if (plated.length === 0) continue
        const cards: Card[] = []
        const sizes: PlateSize[] = []
        const cardBoxes: Box[] = []
        for (const id of plated) {
          const mesh = meshes.current.get(id)!
          const held = badges.byId.get(id)!
          const { hw, hh } = halfOf(mesh)
          const { x, y } = inFrame(mesh)
          cards.push({ x, y, hw, hh })
          sizes.push({ w: held.w, h: held.h })
          cardBoxes.push(boxOfPlane(mesh.position, mesh.rotation, hw, hh, 0, 0))
        }
        const project = (offsets: { dx: number; dy: number }[]) =>
          offsets.map((o, i) => {
            const mesh = meshes.current.get(plated[i]!)!
            const size = sizes[i]!
            return boxOfPlane(mesh.position, plateFrame(mesh), size.w / 2, size.h / 2, o.dx, o.dy)
          })
        const offsets = new Map<string, { dx: number; dy: number }[]>()
        const candidates: Group['candidates'][number][] = []
        if (plated.length === 1 && plated[0] === ids[0]) {
          const card = cards[0]!
          const size = sizes[0]!
          const welded = [{ dx: 0, dy: card.hh + size.h / 2 + gap }]
          offsets.set('welded:1', welded)
          candidates.push({ side: 'welded', ring: 1, boxes: project(welded) })
        }
        for (const side of SIDES) {
          for (let ring = 1; ring <= params.attention.seekReach; ring++) {
            const rungs = ladder(cards, sizes, side, ring, gap)
            offsets.set(`${side}:${ring}`, rungs)
            candidates.push({ side, ring, boxes: project(rungs) })
          }
        }
        const held = groupAt.current.get(zone)
        groups.push({ zone, cards: cardBoxes, candidates, ...(held ? { held } : {}) })
        members.push({ zone, ids: plated, offsets })
      }

      const { picks } = solve(obstacles, cellBoxes, groups, {
        cover: params.attention.seekCover,
        pull: params.attention.seekPull,
        line: params.attention.seekLineCost,
        foreign: params.attention.seekForeign,
        mismatch: params.attention.seekMismatch,
        parallel: params.attention.seekParallel,
        align: params.attention.seekAlign,
        stack: params.attention.seekStack,
        exposed: params.attention.seekExposed,
        settle: params.attention.seekSettle,
      }, usable)
      groupAt.current.clear()
      for (let g = 0; g < members.length; g++) {
        const pick = picks[g]
        const group = members[g]
        if (!pick || !group) continue
        groupAt.current.set(group.zone, pick)
        const rungs = group.offsets.get(`${pick.side}:${pick.ring}`) ?? []
        group.ids.forEach((id, i) => {
          const o = rungs[i]
          if (o) plateAt.current.set(id, { dx: o.dx, dy: o.dy, welded: pick.side === 'welded' })
        })
      }

      // A wall that runs all day sheds artifacts constantly, and neither map
      // is keyed on anything that expires on its own.
      for (const id of plateAt.current.keys()) {
        if (shelf.has(id)) continue
        plateAt.current.delete(id)
        plateMotion.current.delete(id)
      }
    }

    // A badge lies in its card's plane, turning with the wall, or faces the
    // camera whatever the wall does. Its offsets are measured in the same frame
    // it is drawn in, so the two agree from every angle.
    const unturn = new THREE.Quaternion()
    const orient = (plate: THREE.Object3D, card: THREE.Object3D): void => {
      if (params.attention.billboard) plate.quaternion.copy(camera.quaternion)
      else plate.rotation.copy(card.rotation)
    }
    // Billboarded badges all stand on one plane, just in front of the nearest
    // card, so no badge is ever behind a card from another pile. Moved along
    // its own line of sight, which leaves it where it was on screen. Reads the
    // meshes and the camera as the last frame left them.
    const viewDir = camera.getWorldDirection(new THREE.Vector3())
    let frontDepth = Infinity
    if (params.attention.billboard) {
      for (const m of meshes.current.values()) {
        if (!m.visible) continue
        const d = m.position.x * viewDir.x + m.position.y * viewDir.y + m.position.z * viewDir.z
        if (d < frontDepth) frontDepth = d
      }
    }
    const eyeDepth = camera.position.dot(viewDir)
    const planeDepth = frontDepth - BADGE_LIFT - eyeDepth
    const toPlane = (p: THREE.Vector3): void => {
      if (!params.attention.billboard || !Number.isFinite(planeDepth)) return
      const d = p.dot(viewDir) - eyeDepth
      if (d <= 1e-6 || planeDepth <= 1e-6) return
      if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
        p.sub(camera.position).multiplyScalar(planeDepth / d).add(camera.position)
      } else p.addScaledVector(viewDir, planeDepth - d)
    }

    const liveZones = [...new Set(model.map((m) => m.zone))]
    const focused = zoneOf(view)
    const focusedCard = cardOf(view)
    // Not before the daemon has answered: a view restored from the URL names a
    // zone the empty wall of the first frames does not have yet.
    if (
      current.connected &&
      ((focused && !liveZones.includes(focused)) ||
        (focusedCard && !model.some((m) => m.id === focusedCard)))
    ) {
      dispatch({ type: 'prune', live: liveZones, cards: model.map((m) => m.id) })
    }

    const placed = [...result.placements.keys()]
    const changed =
      placed.length !== liveRef.current.length || placed.some((id, i) => liveRef.current[i] !== id)
    if (changed) {
      liveRef.current = placed
      setLive(placed)
    }

    for (const [id, rect] of result.placements as Map<string, Rect>) {
      const mesh = meshes.current.get(id)
      if (!mesh) continue
      const ch = channels.get(id) ?? ({} as TransomChannels)
      const aspect = aspects.get(id) ?? 1
      const side = rect.w

      // The rect is the square slot; the image is fit inside it.
      const drawnW = aspect >= 1 ? side : side * aspect
      const drawnH = aspect >= 1 ? side / aspect : side
      const emphasis = ch.emphasis ?? 0
      const flag = flagged.get(id)
      const tier = params.attention.levels[flag?.level ?? 'look']
      // Breathing, so a flag is findable on a wall the eye is scanning. Scaled
      // by emphasis, so an unflagged artifact is exactly as still as it ever was.
      const pulse =
        1 +
        params.attention.pulse *
          tier.pulseAmp *
          emphasis *
          Math.sin((tick / 1000) * 2 * Math.PI * tier.pulseHz)
      // In place, so hovering never reorders what is in front of what.
      const swell = hovered.current === id && emphasis > 0 ? params.attention.hoverScale : 1
      mesh.scale.set(drawnW * pulse * swell, drawnH * pulse * swell, 1)
      mesh.userData.drawnW = drawnW
      mesh.userData.drawnH = drawnH
      // A rect's x/y is its top-left, three positions a plane by its center, and
      // windease's rect space grows y downward where three's world grows it up.
      // All three corrections happen here and nowhere else.
      //
      // The lift is measured in ranks and travels the pile's own axis, which is
      // the (step.x, step.y, step.z) diagonal rather than world z. Adding it to
      // z alone shears the card out of the line its pile is drawn along: head-on
      // that is invisible, and the moment the wall is turned the flagged card
      // sits beside its stack instead of in front of it.
      const rise = tier.lift * emphasis
      mesh.position.set(
        rect.x + drawnW / 2 - rise * params.step.x,
        -(rect.y + drawnH / 2) + rise * params.step.y,
        rect.z + rise * params.step.z,
      )
      mesh.rotation.set(ch.rotX ?? 0, ch.rotY ?? 0, ch.rotZ ?? 0)

      const mat = mesh.material as THREE.MeshBasicMaterial
      const tex = textures.textureFor(id) ?? null
      if (mat.map !== tex) {
        mat.map = tex
        mat.needsUpdate = true
      }
      // three's default is white, which is the brightest thing on the wall. A
      // card waiting for its decode has to read as a slot, not as a picture.
      const tint = tex ? WHITE : blank
      if (!mat.color.equals(tint)) mat.color.copy(tint)
      const cut = (dimmed.has(id) ? params.overlay.filterDim : 1) * revealed.current
      mat.opacity = (ch.opacity ?? 1) * cut
      mat.transparent = true

      const badge = badges.byId.get(id)
      const wearsBadge = (emphasis > 0 || !!flag?.inert) && !!flag?.note
      if (badge || wearsBadge) {
        const level = flag?.level ?? 'look'
        const fill = levelColors[level]
        const ink = params.colors.flagInk
        // A badge may run past its own artifact's right edge, as far as the
        // next zone begins — a note is worth more than the tidiness of a plate
        // that stops where the picture does.
        const base = zoneFor.get(id) ? bases.current.get(zoneFor.get(id)!) : undefined
        const floats = params.attention.float && shelf.has(id) && !!base
        // A floating plate is measured from its zone's left edge, where the
        // shelf stands. Measuring from the card would give a deep rank almost
        // no width at all, since its rect has already stepped most of the way
        // across the cell.
        const runsFrom = floats && base ? base.x : rect.x
        const runsTo = base ? base.x + base.w + params.zoneGrid.gap : rect.x + side
        const held = badges.sync(
          id,
          `${flag?.note ?? ''}|${fill}|${ink}|${badgeFamily}|${fontsReady}|${params.attention.badgeSize}`,
          flag?.note ?? '',
          fill,
          ink,
          badgeFamily,
          params.attention.badgeSize,
          Math.max(params.attention.badgeSize, runsTo - runsFrom),
        )
        held.plate.visible = wearsBadge
        const slot = shelf.get(id)
        if (wearsBadge && slot !== undefined && base) {
          const { w, h } = held
          held.plate.scale.set(w, h, 1)
          orient(held.plate, mesh)
          // Where the solve put it, if it ran. Otherwise the shelf: plates
          // stacked on the zone's top border, left edges flush with the zone's.
          const solved = params.attention.seek ? plateAt.current.get(id) : undefined
          let eased: { x: number; y: number } | undefined
          if (solved) {
            let m = plateMotion.current.get(id)
            if (!m) {
              // Born on its own card, so a new plate grows out of the artifact
              // rather than appearing somewhere else on the wall.
              m = { x: 0, y: 0, vx: 0, vy: 0 }
              plateMotion.current.set(id, m)
            }
            // Clamped: a tab that has been asleep hands back a delta measured
            // in seconds, and the spring would fling the plate off the wall.
            const dt = Math.min(delta, 1 / 30)
            const k = params.attention.seekStiffness
            const c = params.attention.seekDamping
            m.vx += ((solved.dx - m.x) * k - m.vx * c) * dt
            m.vy += ((solved.dy - m.y) * k - m.vy * c) * dt
            m.x += m.vx * dt
            m.y += m.vy * dt
            if (Math.abs(m.vx) + Math.abs(m.vy) + Math.abs(solved.dx - m.x) + Math.abs(solved.dy - m.y) > 1e-4)
              springing = true
            eased = m
          }
          const shelfY =
            -base.y + params.attention.floatLift + slot * (h + params.attention.floatGap) + h / 2
          const offset = (
            eased
              ? new THREE.Vector3(eased.x, eased.y, BADGE_LIFT)
              : new THREE.Vector3(
                  base.x + w / 2 - mesh.position.x,
                  shelfY - mesh.position.y,
                  BADGE_LIFT,
                )
          ).applyEuler(held.plate.rotation)
          held.plate.position.copy(mesh.position).add(offset)
          toPlane(held.plate.position)
          const plateMat = held.plate.material as THREE.MeshBasicMaterial
          plateMat.transparent = true
          // Half strength once the question is closed: still legible, no longer asking.
          plateMat.opacity = cut * (flag?.inert ? 0.5 : 1)
          // Down to the top of the card, so the line says which artifact is
          // asking even when the plate has climbed clear of the pile. Read off
          // the mesh rather than the rect: a flagged card stands `tier.lift`
          // forward of its rank, and a line drawn to the rect's own z lands
          // behind the card it is pointing at.
          // A plate resting directly on top of its own card needs no line:
          // there is nothing for one to disambiguate. Anything that has moved
          // off the card gets one, however it got there.
          const resting = solved ? solved.welded : noLeader.has(id)
          if (!resting) {
            // Read off the meshes rather than the rects: a flagged card stands
            // `tier.lift` forward of its rank, and a line drawn to the rect's
            // own z lands behind the card it points at.
            // Everything in the plate's own frame: the card's plane when the
            // plate lies in it, the screen when it faces the camera. Depth
            // between the two falls out onto the frame's z, so a plate pulled
            // forward to the badge plane still measures its card where it is.
            const rel = mesh.position
              .clone()
              .sub(held.plate.position)
              .applyQuaternion(unturn.copy(held.plate.quaternion).invert())
            const cx = rel.x
            const cy = rel.y
            const chw = (drawnW * swell * pulse) / 2
            const chh = (drawnH * swell * pulse) / 2
            // The line leaves the center of the edge that faces the card,
            // chosen by which axis the card lies further beyond. The solver's
            // `footOf` is the same rule in screen space.
            const sideways = Math.abs(cx) - w / 2 > Math.abs(cy) - h / 2
            const fx = sideways ? Math.sign(cx) * (w / 2) : 0
            const fy = sideways ? 0 : Math.sign(cy) * (h / 2)
            const points = leaderPoints.get(level) ?? []
            const at = (v: THREE.Vector3) =>
              points.push(
                held.plate.position.x + v.x,
                held.plate.position.y + v.y,
                held.plate.position.z + v.z,
              )
            const foot = new THREE.Vector3(fx, fy, 0).applyEuler(held.plate.rotation)
            if (params.attention.leaderElbow) {
              // Leaves the plate square to the edge the card lies beyond, runs
              // to the card's span, and turns once onto its nearest border. A
              // plate level with its card needs no turn at all.
              let ex: number
              let ey: number
              let hx: number
              let hy: number
              if (sideways) {
                ey = fy
                if (Math.abs(fy - cy) <= chh) {
                  ex = hx = cx - Math.sign(cx) * chw
                  hy = fy
                } else {
                  ex = hx = clamp(fx, cx - chw, cx + chw)
                  hy = cy - Math.sign(cy - fy) * chh
                }
              } else {
                ex = fx
                if (Math.abs(fx - cx) <= chw) {
                  ey = hy = cy - Math.sign(cy) * chh
                  hx = fx
                } else {
                  ey = hy = clamp(fy, cy - chh, cy + chh)
                  hx = cx - Math.sign(cx - fx) * chw
                }
              }
              const elbow = new THREE.Vector3(ex, ey, 0).applyEuler(held.plate.rotation)
              const head = new THREE.Vector3(hx, hy, rel.z).applyEuler(held.plate.rotation)
              const bends = Math.abs(ex - hx) + Math.abs(ey - hy) > 1e-6
              at(foot)
              if (bends) {
                at(elbow)
                at(elbow)
              }
              at(head)
            } else {
              // Between the two nearest edges: the edge of the plate that faces
              // its card, so the line never crosses the plate it comes from, and
              // the point of the card's border nearest the plate, so a plate on
              // the flank gets a short level line rather than a diagonal to the
              // top.
              // The point of the card's border nearest the foot.
              const head = new THREE.Vector3(
                cx + clamp(fx - cx, -chw, chw),
                cy + clamp(fy - cy, -chh, chh),
                rel.z,
              ).applyEuler(held.plate.rotation)
              at(foot)
              at(head)
            }
            leaderPoints.set(level, points)
          }
        } else if (wearsBadge) {
          const { w, h } = held
          held.plate.scale.set(w, h, 1)
          orient(held.plate, mesh)
          // Measured in the plate's own frame and then turned with it, so the
          // badge stays on the top border from every angle rather than
          // sliding off it as the wall turns. Left edges flush.
          held.plate.position
            .copy(mesh.position)
            .add(
              new THREE.Vector3(
                (w - drawnW * swell) / 2,
                (drawnH * swell + h) / 2,
                BADGE_LIFT,
              ).applyEuler(held.plate.rotation),
            )
          toPlane(held.plate.position)
        }
      }

      const chip = chips.byId.get(id)
      const wearsChip = params.chips.cards && fronts.has(id)
      if (chip || wearsChip) {
        const text = ago(now - (bornAt.get(id) ?? now))
        const look = {
          fill: params.colors.chipFill,
          ink: params.colors.chipInk,
          icon: params.colors.chipIcon,
          family: badgeFamily,
        }
        const held = chips.sync(
          id,
          `${text}|${look.fill}|${look.icon}|${look.ink}|${badgeFamily}|${fontsReady}`,
          text,
          look,
        )
        held.plate.visible = wearsChip
        if (wearsChip) {
          const h = chipHeight
          const w = h * held.aspect
          const inset = params.chips.inset
          held.plate.scale.set(w, h, 1)
          held.plate.rotation.copy(mesh.rotation)
          // Inside the artifact's top-left corner. Measured in the card's own
          // frame and then turned with it, so it holds that corner from every
          // angle rather than sliding off it as the wall turns.
          held.plate.position
            .copy(mesh.position)
            .add(
              new THREE.Vector3(
                -(drawnW * swell) / 2 + w / 2 + inset,
                (drawnH * swell) / 2 - h / 2 - inset,
                BADGE_LIFT,
              ).applyEuler(mesh.rotation),
            )
          const material = held.plate.material as THREE.MeshBasicMaterial
          material.opacity = cut
        }
      }

      // A pin says the wall will not take this one. Its own corner, opposite the
      // age chip, because a pinned front card wears both at once.
      const pin = pins.byId.get(id)
      // Not gated on `chips.cards`: that switch is about the age chip, and a
      // pin is state rather than decoration. Gated on the front all the same:
      // a chip draws over the wall, so one on a buried card shows through the
      // front card and reads as the front card's.
      const wearsPin = pinned.has(id) && fronts.has(id)
      if (pin || wearsPin) {
        const held = pins.sync(
          id,
          `pin|${params.colors.chipFill}|${params.colors.chipInk}|${badgeFamily}|${fontsReady}`,
          PIN_GLYPH,
          {
            fill: params.colors.chipFill,
            ink: params.colors.chipInk,
            family: badgeFamily,
          },
        )
        held.plate.visible = wearsPin
        if (wearsPin) {
          const h = chipHeight
          const w = h * held.aspect
          const inset = params.chips.inset
          held.plate.scale.set(w, h, 1)
          held.plate.rotation.copy(mesh.rotation)
          held.plate.position
            .copy(mesh.position)
            .add(
              new THREE.Vector3(
                (drawnW * swell) / 2 - w / 2 - inset,
                (drawnH * swell) / 2 - h / 2 - inset,
                BADGE_LIFT,
              ).applyEuler(mesh.rotation),
            )
          const material = held.plate.material as THREE.MeshBasicMaterial
          material.opacity = cut
        }
      }

      // The bottom-left corner, clear of both the age chip and the pin: a card
      // with more in it than the wall draws can be the front of its pile and
      // rescued at once.
      const play = plays.byId.get(id)
      const playText = playsText.get(id)
      const wearsPlay = playText !== undefined && fronts.has(id)
      if (play || wearsPlay) {
        const text = playText ?? PLAYS_GLYPH
        const held = plays.sync(
          id,
          `${text}|${params.colors.chipFill}|${params.colors.chipInk}|${badgeFamily}|${fontsReady}`,
          text,
          {
            fill: params.colors.chipFill,
            ink: params.colors.chipInk,
            family: badgeFamily,
          },
        )
        held.plate.visible = wearsPlay
        if (wearsPlay) {
          const h = chipHeight
          const w = h * held.aspect
          const inset = params.chips.inset
          held.plate.scale.set(w, h, 1)
          held.plate.rotation.copy(mesh.rotation)
          held.plate.position
            .copy(mesh.position)
            .add(
              new THREE.Vector3(
                -(drawnW * swell) / 2 + w / 2 + inset,
                -(drawnH * swell) / 2 + h / 2 + inset,
                BADGE_LIFT,
              ).applyEuler(mesh.rotation),
            )
          const material = held.plate.material as THREE.MeshBasicMaterial
          material.opacity = cut
        }
      }

      // The bottom-right corner, the last one free. A card can be pinned, hold
      // more than the wall draws, wear its age and still be waiting on a reply.
      const ask = asks.byId.get(id)
      const asksHere = asksText.get(id)
      const wearsAsk = asksHere !== undefined && fronts.has(id)
      if (ask || wearsAsk) {
        // Waiting reads as signage, in the flag's own color: the plate that
        // said so may have lapsed hours ago. Answered reads as a record, in the
        // ordinary chip colors, because nobody has to act on it.
        const look = asksHere?.open
          ? { fill: params.colors.attentionLook, ink: params.colors.flagInk, family: badgeFamily }
          : { fill: params.colors.chipFill, ink: params.colors.chipInk, family: badgeFamily }
        const text = asksHere?.text ?? ASK_GLYPH
        const held = asks.sync(
          id,
          `${text}|${look.fill}|${look.ink}|${badgeFamily}|${fontsReady}`,
          text,
          look,
        )
        held.plate.visible = wearsAsk
        if (wearsAsk) {
          const h = chipHeight
          const w = h * held.aspect
          const inset = params.chips.inset
          held.plate.scale.set(w, h, 1)
          held.plate.rotation.copy(mesh.rotation)
          held.plate.position
            .copy(mesh.position)
            .add(
              new THREE.Vector3(
                (drawnW * swell) / 2 - w / 2 - inset,
                -(drawnH * swell) / 2 + h / 2 + inset,
                BADGE_LIFT,
              ).applyEuler(mesh.rotation),
            )
          const material = held.plate.material as THREE.MeshBasicMaterial
          material.opacity = cut
        }
      }

      // Set here rather than in the memo, which cannot see a zone that arrived
      // since, and which does not know how far the card has faded.
      const edge = edges.byId.get(id)
      if (edge) {
        // The halo wins the line where both want it: a flagged card is not
        // also reporting its slot extent. A card wearing a plate wears the
        // plate's color on its border too, so the two read as one thing.
        const halo = (emphasis > 0 || wearsBadge) && tier.haloWidth > 0
        edge.visible = halo || cardEdges
        const zone = zoneFor.get(id)
        const own = huedCardEdge && zone ? huedColors.get(zone) : undefined
        if (halo) edge.material.color.set(levelColors[flag?.level ?? 'look'])
        else if (own) edge.material.color.copy(own)
        else edge.material.color.set(cardEdgeColor)
        const thicken = hovered.current === id ? params.attention.hoverEdge : 1
        // No thinner than `soon`'s when it is there to match a plate: the
        // `look` halo alone is the ordinary card edge in another color.
        const haloWidth = wearsBadge
          ? Math.max(tier.haloWidth, params.attention.levels.soon.haloWidth)
          : tier.haloWidth
        edge.material.linewidth = halo ? haloWidth * thicken : params.overlay.cardEdgeWidth
        // The halo is the one thing the depth falloff must not mute.
        edge.material.opacity =
          (halo ? Math.max(ch.opacity ?? 1, emphasis, flag?.inert ? 0.5 : 0) : (ch.opacity ?? 1)) * cut
        setResolution(edge.material, gl)
      }
    }

    for (const [level, line] of leaders) {
      const points = leaderPoints.get(level)
      line.visible = !!points
      if (!points) continue
      line.geometry.setPositions(points)
      // setPositions leaves the instance count from whichever frame had the
      // most segments, so a frame with fewer draws past the end of its own
      // buffer. Six numbers is one segment: two endpoints.
      line.geometry.instanceCount = points.length / 6
      line.material.color.set(levelColors[level])
      line.material.linewidth = params.attention.leaderWidth
      setResolution(line.material, gl)
    }

    retarget(depthOf(view), zoneOf(view))
    if (move.current) pose.current = poseAt(move.current, performance.now())

    const extent = showBounds ? bounds.current : null
    boundsLines.outer.visible = boundsLines.inner.visible = extent !== null
    if (extent) {
      // Through the scene's depth, from the deepest card to the frontmost.
      let z0 = 0
      let z1 = 0
      for (const mesh of meshes.current.values()) {
        if (!mesh.visible) continue
        z0 = Math.min(z0, mesh.position.z)
        z1 = Math.max(z1, mesh.position.z)
      }
      const { outer, inner } = extent
      boundsLines.outer.geometry.setPositions(boxPositions(outer.x0, outer.y0, z0, outer.x1, outer.y1, z1))
      boundsLines.outer.geometry.instanceCount = 12
      boundsLines.inner.geometry.setPositions(loopPositions(inner.x0, inner.y0, inner.x1, inner.y1, 0))
      boundsLines.inner.geometry.instanceCount = 4
      setResolution(boundsLines.outer.material, gl)
      setResolution(boundsLines.inner.material, gl)
    }

    applyPose(camera, pose.current, params.camera, window.innerWidth / window.innerHeight)

    const moving =
      (move.current !== null && performance.now() - move.current.startedAt < move.current.durationMs) ||
      now - chipRamp.current.startedAt < params.camera.moveMs ||
      revealed.current < 1 ||
      springing ||
      (params.attention.pulse > 0 && flagged.size > 0)
    if (moving || performance.now() < awakeUntil.current) invalidate()
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

/** How long a reply shows before the lightbox goes, and how long it takes to
 *  go — the second matches `lightbox-out` in lightbox.css. */
const REPLY_HOLD_MS = 1000
const REPLY_CLOSE_MS = 240

/**
 * Puts a camera where a pose says: orbited off the framed point by the yaw
 * and pitch, looking at it, and — under orthographic projection, where the
 * frustum is what frames — sized to the pose's half height.
 */
function applyPose(
  cam: THREE.Camera,
  { x, y, distance, halfHeight }: Pose,
  look: { yawDeg: number; pitchDeg: number },
  aspect: number,
): void {
  const eye = orbitOffset(look.yawDeg, look.pitchDeg, distance)
  cam.position.set(x + eye.x, -y + eye.y, eye.z)
  cam.lookAt(x, -y, 0)
  if ((cam as THREE.OrthographicCamera).isOrthographicCamera) {
    const ortho = cam as THREE.OrthographicCamera
    ortho.top = halfHeight
    ortho.bottom = -halfHeight
    ortho.right = halfHeight * aspect
    ortho.left = -halfHeight * aspect
    ortho.updateProjectionMatrix()
  }
}

export function WebglBackend(props: Props) {
  const [sidebarOpen, setSidebarOpen] = usePersistedFlag('transom.sidebar.open.v1', false)
  const [showBounds, setShowBounds] = usePersistedFlag('transom.debug.bounds.v1', false)
  const [backedOff, setBackedOff] = useState(false)
  const { listed } = props.band
  // The fraction of the canvas the panel covers, measured rather than assumed:
  // its width lives in CSS, and a constant here would drift from it silently.
  // Read on toggle and on resize, never per frame — it forces a layout.
  const sidebarInset = useRef(0)
  const topInset = useRef(0)
  useEffect(() => {
    const measure = () => {
      const el = document.querySelector('.sidebar')
      const w = el?.getBoundingClientRect().width ?? 0
      sidebarInset.current = w > 0 ? w / window.innerWidth : 0
      const band = document.querySelector('.topbar')
      const h = band?.getBoundingClientRect().height ?? 0
      topInset.current = h > 0 ? h / window.innerHeight : 0
    }
    // After the panel has painted, so the element is there to measure.
    const id = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('resize', measure)
    }
  }, [sidebarOpen])

  const [view, dispatch] = useReducer(reduceView, WALL, () => viewFromHash(location.hash))
  // The extra room belongs to the wall rung; walking in and back out lands at
  // the ordinary frame.
  const depth = view.path.length
  useEffect(() => {
    if (depth > 0) setBackedOff(false)
  }, [depth])
  // Replaced, not pushed: every wheel notch is a rung, and a history entry per
  // notch would make Back useless.
  useEffect(() => {
    const hash = hashOfView(view)
    if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname + location.search)
  }, [view])
  useEffect(() => {
    const onHash = () => dispatch({ type: 'to', path: viewFromHash(location.hash).path })
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const [plan, setPlan] = useState<Plan>({ cells: [] })
  const [offWall, setOffWall] = useState(0)
  // Flags the wall never received, merged in below. Held here rather than in
  // App so that a fake reaches the scene by exactly the route a real one does.
  const [fakes, setFakes] = useState<Record<string, FakeFlag>>({})
  // The band's own state, restored from the last visit rather than held here:
  // a filter that survives a reload can hide artifacts that have landed since,
  // which is why the band states what it is narrowed to on its face.
  const { sort, range: filter } = props.band
  const onBand = props.onBand
  const setFilter = useCallback((next: Filter | null) => onBand({ range: next }), [onBand])
  const setSort = useCallback((next: SortKey) => onBand({ sort: next }), [onBand])
  // Empty is every kind. A Set for everything downstream, which wakes the
  // scene on identity, from the array the band is stored as.
  const kinds = useMemo<ReadonlySet<KindKey>>(() => new Set(props.band.kinds), [props.band.kinds])
  const onKind = useCallback(
    (key: KindKey) =>
      onBand((was) => ({
        kinds: was.kinds.includes(key) ? was.kinds.filter((k) => k !== key) : [...was.kinds, key],
      })),
    [onBand],
  )
  const setListed = useCallback((on: (was: boolean) => boolean) => onBand((was) => ({ listed: on(was.listed) })), [onBand])
  // The daemon's clock, ticking, so the band's axis ends at the same `now`
  // every age on the wall is measured against.
  const [now, setNow] = useState(() => Date.now() + props.clockOffset)
  const offset = props.clockOffset
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset), 1000)
    return () => clearInterval(id)
  }, [offset])
  // Read live rather than from the arrangement's descriptor: the panel is the
  // camera's tuning surface, and the arrangement is rebuilt only for layout.
  const { fovDeg: fov, projection } = props.params.camera
  const card = cardOf(view)

  const items = useMemo(() => {
    if (Object.keys(fakes).length === 0) return props.items
    return props.items.map((i) => {
      const fake = fakes[i.id]
      return fake ? { ...i, attention: fake.attention, note: fake.note } : i
    })
  }, [props.items, fakes])

  // Dimmed rather than removed, and ranked last rather than left in place: an
  // excluded artifact keeps a slot on the wall but gives up its place in the
  // pile, so narrowing the band brings what is still in range to the front.
  const range = useMemo(() => resolve(filter, now), [filter, now])
  // The window resolves afresh every tick; the scene wakes on a new set,
  // so hand back the old one while membership holds.
  const lastDimmed = useRef<ReadonlySet<string>>(new Set())
  const dimmed = useMemo(() => {
    const out = new Set<string>()
    for (const i of items) if (!keptBy(i.bornAt, range) || !keptByKind(i, kinds)) out.add(i.id)
    if (sameIds(out, lastDimmed.current)) return lastDimmed.current
    lastDimmed.current = out
    return out
  }, [items, range, kinds])

  const dropFake = useCallback((id: string) => {
    setFakes((was) => {
      if (!(id in was)) return was
      const { [id]: _gone, ...rest } = was
      return rest
    })
  }, [])

  // Opening a card is the thing the flag was asking for, so looking at it is
  // what clears it. Fire-and-forget: the daemon broadcasts the change, and a
  // dismissal that fails costs a halo that is still accurate. Not a card with
  // a question on it, which only an explicit dismiss closes.
  const openedAsks = items.find((i) => i.id === card)?.question !== undefined
  useEffect(() => {
    if (card === null) return
    dropFake(card)
    if (openedAsks) return
    actions.dismiss(card)
  }, [card, openedAsks, dropFake])

  // The daemon has no record of a fabricated flag, so the row's × has to clear
  // it here; a real one still goes the one route that exists for it.
  const dismiss = useCallback(
    (id: string) => {
      dropFake(id)
      actions.dismiss(id, 'close')
    },
    [dropFake],
  )

  // Replying in the lightbox holds long enough to see the reply land, then
  // plays the lightbox out. Called off if the viewer has moved on by then.
  const [closing, setClosing] = useState<string | null>(null)
  const openCard = useRef(card)
  openCard.current = card
  /** The artifact the lightbox is showing, for the callbacks below, which are
   *  bound once and so cannot read it from the render. Set where `lit` is. */
  const openItem = useRef<WallItem | null>(null)
  const leaving = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => leaving.current.forEach(clearTimeout), [])
  const leaveAfterReply = useCallback((id: string) => {
    leaving.current.forEach(clearTimeout)
    leaving.current = [
      setTimeout(() => {
        if (openCard.current !== id) return
        setClosing(id)
        leaving.current.push(
          setTimeout(() => {
            setClosing(null)
            if (openCard.current === id) dispatch({ type: 'out' })
          }, REPLY_CLOSE_MS),
        )
      }, REPLY_HOLD_MS),
    ]
  }, [])

  // The angle eases home over the same time a rung change takes, since the
  // framing is already doing so; snapping the orbit under a gliding frame reads
  // as a jump.
  const turning = useRef(0)
  useEffect(() => () => cancelAnimationFrame(turning.current), [])
  const onParams = props.onParams
  const cameraNow = useRef(props.params.camera)
  cameraNow.current = props.params.camera
  const resetView = useCallback(() => {
    dispatch({ type: 'to', path: [] })
    setBackedOff(false)
    cancelAnimationFrame(turning.current)
    const from = { yaw: cameraNow.current.yawDeg, pitch: cameraNow.current.pitchDeg }
    const start = performance.now()
    const tick = (t: number) => {
      const ms = cameraNow.current.moveMs
      const k = ms > 0 ? Math.min(1, Math.max(0, (t - start) / ms)) : 1
      const eased = 1 - (1 - k) ** 3
      onParams((p) => ({
        ...p,
        camera: { ...homeCamera(p.camera), yawDeg: from.yaw * (1 - eased), pitchDeg: from.pitch * (1 - eased) },
      }))
      if (k < 1) turning.current = requestAnimationFrame(tick)
    }
    turning.current = requestAnimationFrame(tick)
  }, [onParams])

  // A group holds the lightbox open until nothing in it is waiting: a reply to
  // the third of twelve takes is not a reason to put the viewer back on the
  // wall. `lit` is read through a ref because these are bound once.
  const lastOpenQuestion = useCallback((id: string, take?: string) => {
    const item = openItem.current
    if (item?.id !== id || item.kind !== 'group') return true
    const waiting = (item.takes ?? []).filter((t) => t.question !== undefined && t.reply === undefined)
    return waiting.length <= 1 && (take === undefined || waiting[0]?.id === take)
  }, [])
  const answer = useCallback(
    (id: string, reply: { choice?: string; text: string; take?: string }) => {
      actions.answer(id, reply)
      if (lastOpenQuestion(id, reply.take)) leaveAfterReply(id)
    },
    [lastOpenQuestion, leaveAfterReply],
  )
  const dismissInLightbox = useCallback(
    (id: string, take?: string) => {
      if (take === undefined) dismiss(id)
      else actions.dismiss(id, 'close', take)
      if (lastOpenQuestion(id, take)) leaveAfterReply(id)
    },
    [dismiss, lastOpenQuestion, leaveAfterReply],
  )

  /** What the band counts: the pile you are inside, or the whole wall. The
   *  number is what paging the current scope would walk through, so it has to
   *  narrow with the view. */
  // The plan's own copy of what the wall does with a project color, as
  // something an SVG fill can take.
  const planTints = useMemo(() => {
    const out = new Map<string, string>()
    for (const [zone, css] of Object.entries(props.zoneColors)) {
      const hex = liftedHex(css, props.params.zones.huedMinLight)
      if (hex) out.set(zone, hex)
    }
    return out
  }, [props.zoneColors, props.params.zones.huedMinLight])

  const heldZoneNames = useMemo(
    () => new Set(Object.keys(props.pinnedZones)),
    [props.pinnedZones],
  )
  const scope = zoneOf(view)
  const countInScope =
    scope && !(listed && card) && !props.arrangement.flat
      ? items.filter((i) => i.zone === scope).length
      : items.length

  /** The item the lightbox is showing. From `props.items` rather than the
   *  fake-flag overlay, so the meta line reports the wall, not the rehearsal. */
  const lit = card === null ? null : (props.items.find((i) => i.id === card) ?? null)
  openItem.current = lit

  // An arrival loud enough to open itself. It goes through the same dispatch a
  // click does, so Escape leaves it exactly the way it leaves a card you opened
  // yourself, and the flag is dismissed by the looking as usual.
  const announced = props.announce
  useEffect(() => {
    if (announced) dispatch({ type: 'to', path: [announced.zone, announced.id] })
  }, [announced, dispatch])

  const [menu, setMenu] = useState<MenuAt | null>(null)
  /** Set by the first expiry this client asks for. The daemon holds one undo,
   *  and the wall cannot see whether it is still loaded — so this only says
   *  that something has been expired from here, and the route answers for the
   *  rest. */
  const [expired, setExpired] = useState(false)
  const onMenu = useCallback((at: MenuAt) => setMenu(at), [])

  const menuTarget = menu?.target
  const menuItem =
    menuTarget?.kind === 'card' ? items.find((i) => i.id === menuTarget.id) : undefined

  const viewNow = useRef(view)
  viewNow.current = view
  /** One card undone while a card is open, held until its `arrive` lands:
   *  opened before then, the prune bounces the view off a card the wall lacks. */
  const [reopen, setReopen] = useState<string | null>(null)
  const undo = useCallback(() => {
    void actions.undo().then((restored) => {
      if (restored.length === 1 && cardOf(viewNow.current)) setReopen(restored[0]!)
    })
  }, [])
  useEffect(() => {
    const item = reopen === null ? undefined : props.items.find((i) => i.id === reopen)
    if (!item) return
    setReopen(null)
    dispatch({ type: 'to', path: [item.zone, item.id] })
  }, [reopen, props.items])

  /** The menu row clicked once and waiting to be meant. Cleared with the menu,
   *  so arming never survives the gesture that armed it. */
  const [armed, setArmed] = useState<Action | null>(null)
  // A card's zone as well as a zone's own: the card menu offers to zip the
  // pile the card is in, and the row says how many that is.
  const menuZone = menuTarget && 'zone' in menuTarget ? menuTarget.zone : null
  const zoneCount = menuZone === null ? 0 : items.filter((i) => i.zone === menuZone).length

  const act = useCallback(
    (action: Action, app?: number) => {
      const target = menu?.target
      // Two clicks, not a `confirm()`: a browser modal blocks the page's event
      // loop, and this is the one action that can take a whole zone.
      if (action === 'expireZone' && target?.kind === 'zone') {
        if (armed !== 'expireZone') return setArmed('expireZone')
        setArmed(null)
        setMenu(null)
        setExpired(true)
        return actions.expireZone(target.zone)
      }
      if (action === 'configureZone' && target?.kind === 'zone') {
        setArmed(null)
        setMenu(null)
        return props.onConfigureZone(target.zone)
      }
      if (action === 'zipZone' && target && 'zone' in target) {
        setArmed(null)
        setMenu(null)
        return actions.zipZone(target.zone)
      }
      if ((action === 'pinZone' || action === 'unpinZone') && target?.kind === 'zone') {
        setArmed(null)
        setMenu(null)
        return actions.pinZone(target.zone, action === 'pinZone')
      }
      setArmed(null)
      setMenu(null)
      if (action === 'undo') return undo()
      if (target?.kind !== 'card') return
      const id = target.id
      if (action === 'open') return void dispatch({ type: 'to', path: [target.zone, id] })
      if (action === 'openInApp' && menuItem && app !== undefined) {
        // A group's apps belong to the take on the card, so the open is addressed
        // to that take rather than to the card that is drawing it.
        const shown = posterTake(menuItem.takes ?? [])
        return actions.openInApp(shown?.id ?? id, app)
      }
      if (action === 'dismiss') return dismiss(id)
      if (action === 'zipGroup') return actions.zipGroup(id)
      if (action === 'copyArtifact' && menuItem)
        return void copyArtifact(menuItem).catch((e) => console.warn('[menu] copy failed', e))
      if (action === 'copyPath' && menuItem)
        return void navigator.clipboard?.writeText(menuItem.path).catch(() => {})
      if (action === 'pin' || action === 'unpin') return actions.keep(id, action === 'pin')
      if (action === 'expire') {
        setExpired(true)
        return actions.expire(id)
      }
    },
    [menu, menuItem, dispatch, dismiss, undo, armed, props.onConfigureZone],
  )

  const deleteCard = useCallback((id: string) => {
    setExpired(true)
    actions.expire(id)
  }, [])

  const toggleList = useCallback(() => {
    setListed((on) => !on)
    // Focus left on the row would claim the arrows it exists to change.
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  }, [setListed])

  // Guarded against fields only, like the sorts: a focused band row must not
  // swallow its own key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element | null)?.closest?.('input, select, textarea, [contenteditable]')) return
      if (togglesList(e)) setListed((on) => !on)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setListed])

  // The function keys pick a sort. No control guard, unlike the wall's own
  // keys: clicking a sort leaves its button focused, and a guard would then
  // swallow the key that row is labelled with.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = sortFor(e)
      if (!key) return
      e.preventDefault()
      setSort(key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Cmd-Z is what a hand reaches for, and the wall has nothing else to undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
      if (isForAControl(e.target)) return
      e.preventDefault()
      undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])
  // An orthographic camera sees a slab, not a cone, so `far` has to clear the
  // standoff plus everything the rank cap can put behind the wall.
  const far = props.params.camera.standoff * 2 + 100

  return (
    <>
      <Canvas
        key={projection}
        className="scene"
        dpr={[1, 2]}
        orthographic={projection === 'orthographic'}
        camera={{ fov, position: [0, 0, props.params.camera.standoff], near: 0.01, far }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        frameloop="demand"
      >
        <Wall
          sidebarInset={sidebarInset}
          topInset={topInset}
          {...props}
          items={items}
          sort={sort}
          view={view}
          dispatch={dispatch}
          onPlan={setPlan}
          onOffWall={setOffWall}
          onMenu={onMenu}
          dimmed={dimmed}
          listed={listed}
          onDelete={deleteCard}
          backedOff={backedOff}
          onBackOff={setBackedOff}
          showBounds={showBounds}
        />
        <Sky settings={props.params.sky} colors={props.params.colors} />
      </Canvas>
      {props.params.band.shown && (
        <TopBar
          where={scope}
          whereColor={scope ? props.zoneColors[scope] : undefined}
          arrangement={props.arrangement.name}
          count={countInScope}
          offWall={props.arrangement.flat ? offWall : 0}
          listed={listed}
          onList={toggleList}
          connected={props.connected}
          stale={props.stale}
          disk={props.disk}
          look={props.params.band}
          allowParallax={props.params.general.parallax}
          plan={
            <Minimap
              cells={plan.cells}
              focus={zoneOf(view)}
              tints={planTints}
              zones={props.params.zones}
              zoneSettings={props.zoneSettings}
              onFocus={(zone) => dispatch({ type: 'to', path: [zone] })}
            />
          }
          axes={
            <div className="axes">
              <Axes yawDeg={props.params.camera.yawDeg} pitchDeg={props.params.camera.pitchDeg} />
            </div>
          }
          items={items}
          now={now}
          range={filter}
          onRange={setFilter}
          sort={sort}
          onSort={setSort}
          kinds={kinds}
          onKind={onKind}
        />
      )}
      <ResetView sidebarOpen={sidebarOpen} onReset={resetView} />
      <Sidebar
        open={sidebarOpen}
        setOpen={setSidebarOpen}
        items={items.filter((i) => keptBy(i.bornAt, range))}
        clockOffset={props.clockOffset}
        sort={sort}
        pinnedZones={heldZoneNames}
        params={props.params}
        onParams={props.onParams}
        onOpen={(item) => dispatch({ type: 'to', path: [item.zone, item.id] })}
        onDismiss={dismiss}
        fakeCount={Object.keys(fakes).length}
        onGenerate={() => setFakes(fakeFlags(items, Date.now() + props.clockOffset))}
        showBounds={showBounds}
        onShowBounds={setShowBounds}
        onClearFakes={() => setFakes({})}
      />
      {menu && (
        <CardMenu
          at={menu}
          item={menuItem}
          canUndo={expired}
          zoneCount={zoneCount}
          zonePinned={menuZone !== null && menuZone in props.pinnedZones}
          armed={armed}
          look={props.params.menu}
          allowParallax={props.params.general.parallax}
          onAct={act}
          onClose={() => {
            setArmed(null)
            setMenu(null)
          }}
        />
      )}
      {lit && (
        <Lightbox
          item={lit}
          // The pile's own color, so the frame says which zone the artifact
          // came from rather than repeating the wall's one accent.
          tint={planTints.get(lit.zone)}
          now={now}
          quietMs={props.params.nav.quietMs}
          onClose={() => dispatch({ type: 'out' })}
          closing={closing === lit.id}
          onAnswer={answer}
          onDismiss={dismissInLightbox}
        />
      )}
    </>
  )
}
