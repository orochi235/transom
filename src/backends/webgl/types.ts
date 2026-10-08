import type { Dispatch, SetStateAction } from 'react'
import type { Arrangement } from '@/arrangements/index.ts'
import type { MenuAt } from '@/menu/CardMenu.tsx'
import type { BandState } from '@/nav/band-state.ts'
import type { Plan } from '@/nav/Minimap.tsx'
import type { SortKey } from '@/nav/sort.ts'
import type { StackParams } from '@/params.ts'
import type { ViewAction, ViewState } from '@/view-state.ts'
import type { Disk, WallItem, ZoneSettings } from '@shared/protocol.ts'

export type Props = {
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

export type WallProps = Props & {
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
