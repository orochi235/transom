/**
 * transom's params in weasel's asset editor: the schema the corner panel
 * draws, and the prefs sheet's pages that point into it, as a draft to edit,
 * diff, and send to the agent working in this checkout. Served by the dev
 * server only; nothing here writes to source.
 *
 *   /schema.html
 */
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AssetEditor, workspaceCodec, type CustomKinds, type SentAsset, type Workspace } from '@weasel-js/ui'
import '@weasel-js/theme/tokens.css'
import '@weasel-js/ui/style.css'
import { renderersFor } from '@/ParamsForm.tsx'
import { defaultParams } from '@/params.ts'
import { WORKSPACE } from '@/schema/assets.ts'
import { SCHEMA_INBOX_EVENT, SCHEMA_INBOX_ROUTE } from './schemaInbox.ts'
import './schemaPage.css'

const codec = workspaceCodec([])

/** The preview draws the wall's own kinds over the defaults: a swatch picked
 *  there is a look at the control, not a change to anything. */
const RENDERERS = renderersFor(defaultParams, () => {})

/** What the wall's own kinds hold besides a name and a default. */
const KINDS: CustomKinds = {
  choice: {
    default: { kind: 'number', name: 'Default', description: 'The option it starts on.', default: 0 },
  },
  backdrop: {
    default: { kind: 'string', name: 'Default', description: 'The pattern it starts on.', default: 'hatch' },
  },
}

async function send(assets: readonly SentAsset[]): Promise<void> {
  const answer = await fetch(SCHEMA_INBOX_ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assets }),
  })
  if (!answer.ok) throw new Error(`the dev server answered ${answer.status}`)
}

/** Whether a send is still in the inbox; null until the dev server has said. */
function useWaiting(): [boolean | null, () => void] {
  const [waiting, setWaiting] = useState<boolean | null>(null)
  useEffect(() => {
    const take = (said: { waiting: boolean }) => setWaiting(said.waiting)
    void fetch(SCHEMA_INBOX_ROUTE)
      .then((answer) => answer.json())
      .then(take, () => {})
    import.meta.hot?.on(SCHEMA_INBOX_EVENT, take)
    return () => import.meta.hot?.off(SCHEMA_INBOX_EVENT, take)
  }, [])
  return [waiting, () => setWaiting(true)]
}

function SchemaPage() {
  const [draft, setDraft] = useState<Workspace>(WORKSPACE)
  const [waiting, sent] = useWaiting()
  return (
    <div className="schema-page">
      <AssetEditor
        className="schema-page__editor"
        draftKey="transom.schema.draft.v1"
        workspace={draft}
        original={WORKSPACE}
        codec={codec}
        list
        onChange={setDraft}
        maxDepth={5}
        kinds={KINDS}
        renderers={RENDERERS}
        bar={
          <h1 className="schema-page__title">
            <strong>transom</strong> prefs editor
          </h1>
        }
        onSubmit={(assets) => send(assets).then(sent)}
        taken={waiting === false}
      />
    </div>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('no #root element')
createRoot(root).render(
  <StrictMode>
    <SchemaPage />
  </StrictMode>,
)
