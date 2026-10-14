import type { Workspace } from '@weasel-js/ui'
import { PARAMS } from '@/schema/params.ts'
import { SHEET } from '@/schema/sheet.ts'

/** The id the schema page and a send know the params schema by. */
export const PARAMS_ASSET = 'params'

/** The id of a sheet page's layout. */
export const sheetAsset = (page: string) => `sheet-${page}`

/**
 * What the schema page edits: the params schema, which the corner panel draws
 * as it stands, and each page of the prefs sheet as a layout of pointers into
 * it.
 */
export const WORKSPACE: Workspace = {
  assets: [
    { id: PARAMS_ASSET, label: 'Params', kind: 'schema', root: PARAMS },
    ...SHEET.map((page) => ({
      id: sheetAsset(page.id),
      label: `Sheet: ${page.root.name}`,
      kind: 'layout' as const,
      over: PARAMS_ASSET,
      root: page.root,
    })),
  ],
}
