import { useMemo, useRef, type ReactNode } from 'react'
import { Panel } from '@/panel/index.ts'
import type { Filter } from '@/nav/time-filter.ts'
import { kindTally, type KindKey } from '@/nav/kind-filter.ts'
import { hostTally } from '@/nav/host-filter.ts'
import type { SortKey } from '@/nav/sort.ts'
import type { Disk, WallItem } from '@shared/protocol.ts'
import type { StackParams } from '@/params.ts'
import type { ClientStale } from '@/dev/clientStale.ts'
import { TimePanel } from '@/topbar/TimePanel.tsx'
import { SortPanel } from '@/topbar/SortPanel.tsx'
import { TallyPanel } from '@/topbar/TallyPanel.tsx'
import { ViewPanel } from '@/topbar/ViewPanel.tsx'
import { useBandParallax, usePublishedHeight } from '@/topbar/useBand.ts'
import './topbar.css'

/**
 * The wall's filters. A band rather than a toolbar: each section is a block
 * with room for a real control, because a filter over time is a shape you read
 * before it is a value you set.
 */
export function TopBar({
  items,
  now,
  range,
  onRange,
  sort,
  onSort,
  kinds,
  onKind,
  hosts,
  onHost,
  where,
  whereColor,
  arrangement,
  count,
  offWall = 0,
  connected,
  stale,
  pageStale,
  disk,
  plan,
  axes,
  look,
  allowParallax,
  listed,
  onList,
}: {
  items: readonly WallItem[]
  /** The daemon's clock, so the axis agrees with every age on the wall. */
  now: number
  range: Filter | null
  onRange: (next: Filter | null) => void
  sort: SortKey
  onSort: (next: SortKey) => void
  /** The kinds the wall is narrowed to. Empty is every kind. */
  kinds: ReadonlySet<KindKey>
  /** One kind turned on or off; the band never sets the whole set. */
  onKind: (key: KindKey) => void
  /** The sending Macs the wall is narrowed to. Empty is every Mac. */
  hosts: ReadonlySet<string>
  onHost: (key: string) => void
  /** The zone the view is inside, or null for the wall itself. */
  where: string | null
  /** That zone's project color, where it has one. The wall's own accent
   *  stands for the wall itself and for a zone with no `.hued` behind it. */
  whereColor?: string
  /** How the wall is laid out, and how many artifacts are on it. */
  arrangement: string
  count: number
  /** How many of them the arrangement had no room to show. */
  offWall?: number
  /** Whether the daemon is still on the other end of the socket. */
  connected: boolean
  /** The daemon is running other code than this wall. Said out loud because
   *  every symptom of it looks like a broken feature instead. */
  stale: boolean
  /** Files the dev server never heard had changed, so this page predates them. */
  pageStale: ClientStale | null
  /** What the wall holds on disk against its cap; null until the daemon says. */
  disk: Disk | null
  /** The wall's plan view and its axis gizmo. Passed in rather than built
   *  here: both read the live camera, which the band has no other reason to
   *  know about. */
  plan?: ReactNode
  axes?: ReactNode
  look: StackParams['band']
  /** The app-wide parallax gate, over `look.parallax`. */
  allowParallax: boolean
  /** Whether the lightbox pages the whole wall as one list. */
  listed: boolean
  onList: () => void
}) {
  const tally = useMemo(() => kindTally(items), [items])
  const senders = useMemo(() => hostTally(items, hosts), [items, hosts])

  const band = useRef<HTMLElement>(null)
  usePublishedHeight(band)
  useBandParallax(band, look, allowParallax)

  return (
    <header className="topbar" ref={band} aria-label="Wall filters">
      {/* Classes in here are static and state rides on attributes: delamin8r
          writes `dl-plane` onto these elements, and React setting `className`
          strips it. */}
      <TimePanel items={items} now={now} range={range} onRange={onRange} />

      <SortPanel sort={sort} onSort={onSort} />

      {/* Beside the sort, because both are about which artifacts the eye is
          meant to land on. Only the kinds the wall actually holds: a button
          that filters nothing still has to be read before it can be ignored. */}
      {tally.length > 0 && <TallyPanel name="type" rows={tally} picked={kinds} onPick={onKind} />}

      {senders.length > 0 && <TallyPanel name="from" rows={senders} picked={hosts} onPick={onHost} />}

      <ViewPanel
        where={where}
        whereColor={whereColor}
        arrangement={arrangement}
        listed={listed}
        onList={onList}
        count={count}
        offWall={offWall}
        connected={connected}
        stale={stale}
        pageStale={pageStale}
        disk={disk}
      />
      {plan && (
        <Panel name="map" tight>
          {plan}
        </Panel>
      )}
      {axes && (
        <Panel name="axes" tight>
          {axes}
        </Panel>
      )}
    </header>
  )
}
