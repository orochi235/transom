import type { CSSProperties } from 'react'
import { Panel, PanelRow } from '@/panel/index.ts'
import type { Disk } from '@shared/protocol.ts'
import type { ClientStale } from '@/dev/clientStale.ts'

const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1)

/** Where you are, held against the right edge and away from what you are
 *  filtering. */
export function ViewPanel({
  where,
  whereColor,
  arrangement,
  listed,
  onList,
  count,
  offWall,
  connected,
  stale,
  pageStale,
  disk,
}: {
  where: string | null
  whereColor?: string
  arrangement: string
  listed: boolean
  onList: () => void
  count: number
  offWall: number
  connected: boolean
  stale: boolean
  pageStale: ClientStale | null
  disk: Disk | null
}) {
  return (
    <Panel name="view" tight pushed>
      <div className="topbar__view">
        {/* A color per zone cannot be a class, so the value rides in as a
            custom property and the stylesheet decides what to do with it. */}
        <span
          className="topbar__where"
          data-hued={whereColor ? '' : undefined}
          style={whereColor ? ({ '--where': whereColor } as CSSProperties) : undefined}
        >
          {where ?? 'wall'}
        </span>
        {/* The keys are the only thing that says the arrangement can be
            swapped at all — there is no control to find. */}
        <PanelRow
          label={arrangement}
          keys={['[', ']']}
          keysTitle="[ and ] swap the arrangement"
        />
        <PanelRow
          label="list"
          keys={['L']}
          keysTitle="L pages the whole wall as one list"
          selected={listed}
          onSelect={onList}
        />
        <span className="topbar__tally">
          <span className="topbar__count">{count}</span> {count === 1 ? 'item' : 'items'}
          {offWall > 0 && (
            <>
              {' · '}
              <span className="topbar__count">{offWall}</span> off wall
            </>
          )}
        </span>
        {!connected && <span className="topbar__offline">offline</span>}
        {connected && stale && (
          <span className="topbar__stale" title="The daemon is running a different build. Run npm run daemon:restart.">
            daemon stale
          </span>
        )}
        {pageStale && (
          <span
            className="topbar__stale"
            title={`The dev server missed edits to ${pageStale.files.join(', ')}${pageStale.count > pageStale.files.length ? ` and ${pageStale.count - pageStale.files.length} more` : ''}. Run transom cycle.`}
          >
            page stale
          </span>
        )}
        {connected && disk?.over && (
          <span
            className="topbar__disk"
            title={`Cards the wall may not evict (pinned, eternal zones, open questions, undelivered drawings) hold ${gb(disk.wallBytes)} GB, over the wall's ${gb(disk.wallMax)} GB cap.`}
          >
            disk
          </span>
        )}
      </div>
    </Panel>
  )
}
