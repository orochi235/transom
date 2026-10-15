import { ago } from '@/age.ts'
import { emphasisAt } from '@shared/attention.ts'
import { sortFlags, type SortKey } from '@/nav/sort.ts'
import type { WallItem } from '@shared/protocol.ts'

export function Flags({
  items,
  now,
  sort,
  pinnedZones,
  onOpen,
  onDismiss,
}: {
  items: readonly WallItem[]
  now: number
  /** The band's key, read and never set here: the list and the wall agree
   *  about what is at the top because neither owns the order. */
  sort: SortKey
  /** The zones held at the top of the wall, for the same reason. */
  pinnedZones: ReadonlySet<string>
  onOpen: (item: WallItem) => void
  onDismiss: (id: string) => void
}) {
  const flagged = sortFlags(
    items.filter((i) => i.attention),
    sort,
    now,
    pinnedZones,
  )
  if (flagged.length === 0) return <p className="sidebar__empty">nothing is asking</p>

  return (
    <ul className="sidebar__flags">
      {flagged.map((item) => (
        <li
          className={`sidebar__flag ${
            emphasisAt(item.attention, item.bornAt, now) > 0 ? '' : 'sidebar__flag--lapsed'
          }`}
          key={item.id}
        >
          {/* The row is the target, not the <li>: a list item's box and role
              belong to the list. */}
          <div
            className="sidebar__flagRow"
            role="button"
            tabIndex={0}
            onClick={() => onOpen(item)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              onOpen(item)
            }}
          >
            {/* The level's color is already a custom property on the root,
                written by applyColors from the same params the scene reads. */}
            <span className={`sidebar__dot sidebar__dot--${item.attention?.level ?? 'look'}`} />
            {/* Never the level's name: a level is a treatment, and reading it
                back as text is the substitution the badge refuses to make. */}
            <span className="sidebar__flagNote">{item.note ?? item.name}</span>
            <span className="sidebar__flagWhere">
              {item.zone} · {ago(now - item.bornAt)}
            </span>
          </div>
          <button
            type="button"
            className="sidebar__dismiss"
            onClick={() => onDismiss(item.id)}
            aria-label={`Dismiss ${item.note ?? item.name}`}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}
