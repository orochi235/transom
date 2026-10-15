import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { ParamsPanel } from '@/ParamsPanel.tsx'
import type { SortKey } from '@/nav/sort.ts'
import type { StackParams } from '@/params.ts'
import type { WallItem } from '@shared/protocol.ts'
import { Section } from '@/sidebar/Section.tsx'
import { Flags } from '@/sidebar/Flags.tsx'
import { AlertButtons } from '@/sidebar/AlertButtons.tsx'
import { SynthButtons } from '@/sidebar/SynthButtons.tsx'
import './sidebar.css'

/**
 * The HUD the corners cannot hold. A column over the wall rather than beside
 * it: the scene is framed to the window, and narrowing the canvas would
 * re-frame every pile the moment the panel opened.
 */
export function Sidebar({
  items,
  clockOffset,
  sort,
  pinnedZones,
  params,
  onParams,
  onOpen,
  onDismiss,
  fakeCount,
  onGenerate,
  onClearFakes,
  showBounds,
  onShowBounds,
  open,
  setOpen,
}: {
  items: readonly WallItem[]
  clockOffset: number
  sort: SortKey
  /** The zones held at the top of the wall. */
  pinnedZones: ReadonlySet<string>
  params: StackParams
  onParams: Dispatch<SetStateAction<StackParams>>
  onOpen: (item: WallItem) => void
  onDismiss: (id: string) => void
  /** How many flags on the wall are the debug panel's own. */
  fakeCount: number
  onGenerate: () => void
  onClearFakes: () => void
  showBounds: boolean
  onShowBounds: (on: boolean) => void
  /** Owned by the wall, which frames around the panel while it is up. */
  open: boolean
  setOpen: Dispatch<SetStateAction<boolean>>
}) {
  // Ticks the ages rather than the wall: the rows read a clock, and the scene
  // has its own frame loop that this must not join.
  const [now, setNow] = useState(() => Date.now() + clockOffset)
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setNow(Date.now() + clockOffset), 1000)
    return () => clearInterval(id)
  }, [open, clockOffset])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '\\') setOpen((was) => !was)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  if (!open) {
    return (
      <button
        type="button"
        className="sidebar__tab"
        onClick={() => setOpen(true)}
        aria-label="Open sidebar"
      >
        ‹
      </button>
    )
  }

  return (
    // `data-wzl-portal-host` and the skin sit together on purpose: a weasel
    // overlay portals into the nearest ancestor carrying one, and resolves its
    // `--wzl-*` there. On the body — the default — it paints no surface at all,
    // so a dropdown opens as bare text over the wall. The sidebar is the
    // highest element the panels share and nothing delaminates it, so an
    // overlay hosted here is never under a plane's transform.
    <aside className="sidebar wzl-skin" data-wzl-portal-host aria-label="Wall sidebar">
      <header className="sidebar__head">
        <span className="sidebar__title">transom</span>
        <button
          type="button"
          className="sidebar__close"
          onClick={() => setOpen(false)}
          aria-label="Close sidebar"
        >
          ×
        </button>
      </header>

      <Section name="flags" storageKey="transom.sidebar.flags.v1">
        <Flags
          items={items}
          now={now}
          sort={sort}
          pinnedZones={pinnedZones}
          onOpen={onOpen}
          onDismiss={onDismiss}
        />
      </Section>

      <Section name="debug" storageKey="transom.sidebar.debug.v1">
        <div className="sidebar__cluster">
          <div className="sidebar__buttons">
            <button type="button" className="params__button" onClick={onGenerate}>
              flag 8 random
            </button>
            <button
              type="button"
              className="params__button"
              onClick={onClearFakes}
              disabled={fakeCount === 0}
            >
              clear {fakeCount > 0 ? fakeCount : ''}
            </button>
          </div>
          <p className="sidebar__empty">
            fabricated in this tab only — the daemon never sees them
          </p>
        </div>
        <AlertButtons items={items} onOpen={onOpen} />
        <SynthButtons />
        <label className="sidebar__toggle">
          <input type="checkbox" checked={showBounds} onChange={(e) => onShowBounds(e.target.checked)} />
          camera bounds
        </label>
      </Section>

      <Section name="params" storageKey="transom.sidebar.params.v1">
        <ParamsPanel params={params} onChange={onParams} />
      </Section>
    </aside>
  )
}
