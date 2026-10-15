import { Panel, PanelRow, PanelRows } from '@/panel/index.ts'

/** A panel of toggles with a tally each, laid out as the sort's rows so the
 *  panels beside each other read as one list: the name against the left wall,
 *  its tally against the right, where the sort keeps its keys. */
export function TallyPanel<K extends string>({
  name,
  rows,
  picked,
  onPick,
}: {
  name: string
  rows: readonly { key: K; label: string; count: number }[]
  picked: ReadonlySet<K>
  onPick: (key: K) => void
}) {
  return (
    <Panel name={name} tight>
      <PanelRows>
        {rows.map((row) => (
          <PanelRow
            key={row.key}
            className="topbar__kind"
            selected={picked.has(row.key)}
            onSelect={() => onPick(row.key)}
          >
            <span>{row.label}</span>
            <span className="topbar__count">{row.count}</span>
          </PanelRow>
        ))}
      </PanelRows>
    </Panel>
  )
}
