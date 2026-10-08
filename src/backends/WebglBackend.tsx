import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sky } from '@/backends/Sky.tsx'
import { CardMenu } from '@/menu/CardMenu.tsx'
import { fakeFlags } from '@/debug-flags.ts'
import { Lightbox } from '@/Lightbox.tsx'
import { Axes } from '@/nav/Axes.tsx'
import { keptByKind, type KindKey } from '@/nav/kind-filter.ts'
import { Minimap, type Plan } from '@/nav/Minimap.tsx'
import type { SortKey } from '@/nav/sort.ts'
import { keptBy, resolve, sameIds, type Filter } from '@/nav/time-filter.ts'
import { liftedHex } from '@/nav/zone-tint.ts'
import { ResetView } from '@/ResetView.tsx'
import { Sidebar } from '@/Sidebar.tsx'
import { TopBar } from '@/TopBar.tsx'
import { usePersistedFlag } from '@/usePersistedFlag.ts'
import { cardOf, zoneOf } from '@/view-state.ts'
import type { Props } from '@/backends/webgl/types.ts'
import { useBandKeys } from '@/backends/webgl/useBandKeys.ts'
import { useCardMenu } from '@/backends/webgl/useCardMenu.ts'
import { useFakeFlags } from '@/backends/webgl/useFakeFlags.ts'
import { useInsets } from '@/backends/webgl/useInsets.ts'
import { useReplies } from '@/backends/webgl/useReplies.ts'
import { useResetView } from '@/backends/webgl/useResetView.ts'
import { useViewHash } from '@/backends/webgl/useViewHash.ts'
import { Wall } from '@/backends/webgl/Wall.tsx'

export function WebglBackend(props: Props) {
  const [sidebarOpen, setSidebarOpen] = usePersistedFlag('transom.sidebar.open.v1', false)
  const [showBounds, setShowBounds] = usePersistedFlag('transom.debug.bounds.v1', false)
  const [backedOff, setBackedOff] = useState(false)
  const { listed } = props.band
  const { sidebarInset, topInset } = useInsets(sidebarOpen)

  const [view, dispatch] = useViewHash()
  // The extra room belongs to the wall rung; walking in and back out lands at
  // the ordinary frame.
  const depth = view.path.length
  useEffect(() => {
    if (depth > 0) setBackedOff(false)
  }, [depth])
  const [plan, setPlan] = useState<Plan>({ cells: [] })
  const [offWall, setOffWall] = useState(0)
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
  const { items, fakes, setFakes, dismiss } = useFakeFlags(props, card)

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

  const { closing, openItem, answer, dismissInLightbox } = useReplies(card, dispatch, dismiss)
  const resetView = useResetView(props, dispatch, setBackedOff)

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

  const { menu, setMenu, onMenu, menuItem, menuZone, zoneCount, expired, armed, setArmed, act, deleteCard, undo } =
    useCardMenu(props, items, view, dispatch, dismiss)

  const toggleList = useCallback(() => {
    setListed((on) => !on)
    // Focus left on the row would claim the arrows it exists to change.
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  }, [setListed])

  useBandKeys(setListed, setSort, undo)

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
