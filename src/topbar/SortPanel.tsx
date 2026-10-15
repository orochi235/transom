import { Panel, PanelRow, PanelRows } from '@/panel/index.ts'
import { SORTS, type SortKey } from '@/nav/sort.ts'

/** One key, both places: the zones on the wall and the flag list in the
 *  sidebar. */
export function SortPanel({ sort, onSort }: { sort: SortKey; onSort: (next: SortKey) => void }) {
  return (
    <Panel name="sort" tight>
      <PanelRows>
        {SORTS.map((option, i) => (
          <PanelRow
            key={option.key}
            label={option.label}
            keys={[`F${i + 1}`]}
            selected={sort === option.key}
            onSelect={() => onSort(option.key)}
          />
        ))}
      </PanelRows>
    </Panel>
  )
}
