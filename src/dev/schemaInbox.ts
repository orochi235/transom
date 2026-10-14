/**
 * What the schema page sends, as the dev server keeps it for the agent working
 * in this checkout: one JSON line a send, in a file that holds the latest few.
 */

/** Where the page posts a send and asks what is still waiting. */
export const SCHEMA_INBOX_ROUTE = '/__schema/submit'

/** The file the sends land in, under the checkout's root. */
export const SCHEMA_INBOX_FILE = '.transom/schema-changes.jsonl'

/** The event the dev server sends the page when the file changes. */
export const SCHEMA_INBOX_EVENT = 'transom:schema-inbox'

/** How many sends the file holds before the oldest goes. */
export const KEEP_SENDS = 20

/** The largest send taken, in bytes. The whole schema's literal is under a
 *  hundred kilobytes. */
export const MAX_SEND_BYTES = 1_000_000

/** One changed asset: the params schema, or a sheet page's layout of pointers. */
export interface SentSchemaAsset {
  /** `params`, or `sheet-<page>`. */
  id: string
  kind: 'schema' | 'layout'
  /** Its changes since the one in source, as the editor lists them. */
  changes: readonly unknown[]
  /** The edited asset as a TypeScript literal. */
  literal: string
}

export interface SchemaSend {
  assets: readonly SentSchemaAsset[]
}

function assetOf(sent: unknown): SentSchemaAsset | null {
  if (typeof sent !== 'object' || sent === null) return null
  const { id, kind, changes, literal } = sent as Record<string, unknown>
  if (typeof id !== 'string' || typeof literal !== 'string' || !Array.isArray(changes)) return null
  if (kind !== 'schema' && kind !== 'layout') return null
  return { id, kind, changes, literal }
}

/** A posted body as a send, or null where it is not one. */
export function sendOf(body: string): SchemaSend | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { assets } = parsed as Record<string, unknown>
  if (!Array.isArray(assets) || assets.length === 0) return null
  const taken = assets.map(assetOf)
  return taken.includes(null) ? null : { assets: taken as SentSchemaAsset[] }
}

/** The file's text with one send added at its end, the oldest dropped past `keep`. */
export function withSend(file: string, send: SchemaSend, at: string, keep = KEEP_SENDS): string {
  const lines = file.split('\n').filter((line) => line.length > 0)
  lines.push(JSON.stringify({ at, ...send }))
  return `${lines.slice(-keep).join('\n')}\n`
}

/** Whether the file still holds a send: sent, and not yet applied and removed. */
export function hasWaiting(file: string): boolean {
  return file.split('\n').some((line) => line.length > 0)
}
