import { useState } from 'react'
import { actions, type Plan } from '@/actions.ts'
import { ALERTS, LEVELS, type Level } from '@shared/attention.ts'
import type { WallItem } from '@shared/protocol.ts'

/** What a plan did, in the words of the things that happened. */
const readPlan = (level: Level, plan: Plan, opened: boolean): string => {
  const did = [
    plan.sound ? 'sound' : null,
    plan.notify ? 'notification' : null,
    plan.raise === 'front' ? 'window forward' : plan.raise === 'start' ? 'window started' : null,
    opened ? 'lightbox' : null,
  ].filter(Boolean)
  return did.length === 0 ? `${level}: nothing beyond the badge` : `${level}: ${did.join(' · ')}`
}

/**
 * One button per level, firing that level's whole treatment.
 *
 * Three of the four effects are the daemon's, so unlike `fakeFlags` this
 * cannot be faked in the page: the route runs the same `alert` an arrival
 * runs. The fourth, the lightbox, is the wall's own, so it opens here — on a
 * real artifact, because a lightbox over an item that resolves to no file
 * shows the level's treatment as a broken image.
 */
export function AlertButtons({
  items,
  onOpen,
}: {
  items: readonly WallItem[]
  onOpen: (item: WallItem) => void
}) {
  const [said, setSaid] = useState<string | null>(null)

  const fire = async (level: Level) => {
    setSaid(`${level}…`)
    const shown = ALERTS[level].lightbox ? items[Math.floor(Math.random() * items.length)] : undefined
    try {
      const plan = await actions.fireAlert(level)
      if (!plan) return setSaid(`${level}: the daemon refused it`)
      if (shown) onOpen(shown)
      setSaid(readPlan(level, plan, !!shown))
    } catch {
      setSaid(`${level}: no daemon`)
    }
  }

  return (
    <div className="sidebar__cluster">
      <div className="sidebar__buttons">
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            className={`params__button sidebar__alert sidebar__alert--${level}`}
            onClick={() => void fire(level)}
          >
            {level}
          </button>
        ))}
      </div>
      <p className="sidebar__empty">{said ?? 'fires the real treatment — the daemon runs it'}</p>
    </div>
  )
}
