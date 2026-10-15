import { useState } from 'react'
import { actions } from '@/actions.ts'

/**
 * Artifacts the wall makes for itself: a group to page through, a card with a
 * question, and one already answered — the last because clicking is what it is
 * there to check, so the answered state cannot be reached by clicking.
 *
 * Real sends, into the `debug` zone on a short TTL. The alternative, a card
 * fabricated in this tab, could not be answered at all: its id reaches no
 * daemon, and a carousel nobody can click says nothing about the carousel.
 */
export function SynthButtons() {
  const [said, setSaid] = useState<string | null>(null)
  const [takes, setTakes] = useState(5)

  const make = async (what: 'group' | 'ask' | 'answered', n?: number) => {
    setSaid(`${what}…`)
    setSaid((await actions.synth(what, n)) ? `${what} sent` : `${what}: the daemon refused it`)
  }

  return (
    <div className="sidebar__cluster">
      <div className="sidebar__buttons">
        <button type="button" className="params__button" onClick={() => void make('group', takes)}>
          group of {takes}
        </button>
        <label className="sidebar__count">
          takes
          <input
            type="number"
            min={1}
            max={12}
            value={takes}
            onChange={(e) => setTakes(Math.min(12, Math.max(1, Number(e.target.value) || 1)))}
          />
        </label>
      </div>
      <div className="sidebar__buttons">
        <button type="button" className="params__button" onClick={() => void make('ask')}>
          question
        </button>
        <button type="button" className="params__button" onClick={() => void make('answered')}>
          answered
        </button>
      </div>
      <p className="sidebar__empty">
        {said ?? 'real sends into the debug zone, on a 20m TTL'}
      </p>
    </div>
  )
}
