import { actions } from '@/actions.ts'
import type { TakeApp, TakeLink } from '@shared/protocol.ts'

/**
 * Where an artifact says to go next: the apps the daemon can open it in, and
 * the pages the sender says it is about. Under the question, because a verdict
 * is often not the end of it — the render is wrong and the next move is the
 * source file in the app that made it.
 */
export function Outs({ id, apps, links }: { id: string; apps?: TakeApp[]; links?: TakeLink[] }) {
  if (!apps?.length && !links?.length) return null
  return (
    // A click here is not the wall's: it would close the lightbox under the
    // button that was just pressed.
    <div className="lightbox__outs" onClick={(e) => e.stopPropagation()}>
      {apps?.map((app, at) => (
        <button
          type="button"
          className="lightbox__out"
          key={`${app.name}-${at}`}
          onClick={() => actions.openInApp(id, at)}
        >
          Open in {app.name}
        </button>
      ))}
      {links?.map((link) => (
        <a
          className="lightbox__out"
          key={link.url}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {link.label}
        </a>
      ))}
    </div>
  )
}
