import type { PrefGroup } from '@weasel-js/prefs'
import { isPrefLeaf } from '@weasel-js/prefs'
import { ParamsForm } from '@/ParamsForm.tsx'
import { ParamsTransfer } from '@/ParamsTransfer.tsx'
import type { StackParams } from '@/params.ts'
import { PARAMS } from '@/schema/params.ts'

/** What the params at the schema's top level, outside any group, fold under. */
const TOP = 'wall'

type Fold = { name: string; root: PrefGroup }

/**
 * One fold per top-level group of the schema, the loose params leading under a
 * fold of their own. Each fold's root holds its group under the group's own
 * key, so a row's path is the param's whatever fold draws it; the group is
 * left unnamed there because the fold's summary already names it.
 */
const FOLDS: readonly Fold[] = (() => {
  const loose: PrefGroup['children'] = {}
  const folds: Fold[] = []
  for (const [key, child] of Object.entries(PARAMS.children)) {
    if (isPrefLeaf(child)) loose[key] = child
    else folds.push({ name: child.name, root: { name: '', children: { [key]: { ...child, name: '' } } } })
  }
  return [{ name: TOP, root: { name: '', children: loose } }, ...folds]
})()

/**
 * Every param, a fold per group, for the column beside the wall. Folded
 * because the column is narrow and the list is long: only the wall's own
 * scalars start open.
 */
export function ParamsPanel({
  params,
  onChange,
}: {
  params: StackParams
  onChange: (next: StackParams) => void
}) {
  return (
    <>
      <ParamsTransfer params={params} onChange={onChange} />
      {FOLDS.map((fold) => (
        <details className="params__group" key={fold.name} open={fold.name === TOP}>
          <summary className="params__groupName">{fold.name}</summary>
          <ParamsForm schema={fold.root} params={params} onChange={onChange} />
        </details>
      ))}
    </>
  )
}
