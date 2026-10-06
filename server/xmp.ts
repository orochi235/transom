import type { TakeApp, TakeLink } from '@shared/protocol.ts'

/** What the wall knows about where an image came from. */
export type Stamp = {
  /** The Mac a remote send came from. Absent for a send from this one. */
  host?: string
  /** What the image shows. The only field a person writes. */
  caption?: string
  zone?: string
  /** The repository the render came out of, and the commit it was made at. */
  repo?: string
  sha?: string
  /** How hard this asks to be looked at, as written: `look`, `30m`,
   *  `look:90s`, `until-dismissed`. Parsed at ingest, not here. */
  attention?: string
  /** What the badge on a flagged card says. The agent's words, not the wall's. */
  note?: string
  /** Not written into the XMP: an HTML file is never stamped, since
   *  `stampOriginal` returns early for anything but a PNG. */
  sandbox?: string
  /** What the agent asked, and the answers it offered. No choices means the
   *  answer is free text. Sidecar only, like `kept`. */
  question?: string
  choices?: string[]
  /** The placeholder for the free-text box offered beside the choices. Absent
   *  means the question offers no box. */
  why?: string
  /** The group this file joins, as `--group` named it, and what the sender said
   *  about the group itself. A file naming a group is a take rather than a card of
   *  its own. Sidecar only. */
  group?: string
  groupLabel?: string
  /** How many takes the group said were coming. */
  of?: number
  /** Apps the sender offered for this take, and pages it points at. Structured
   *  rather than strings, so they never reach the XMP packet. */
  apps?: TakeApp[]
  links?: TakeLink[]
  /** The repo said never to play this card's sound (`.transom.yaml`). */
  quiet?: boolean
  /** How the question closed, what it was answered with, and when (ISO).
   *  `choice` is the chip, `reply` the free text; a question offering both
   *  carries both. */
  closed?: string
  choice?: string
  reply?: string
  closedAt?: string
  /** The Claude Code session that sent this and its process, from the
   *  environment `bin/transom` ran in. Where a drawing on the card goes back
   *  to. Sidecar only. */
  session?: string
  pid?: number
  /** When the wall rescued this, ISO. Wall state rather than provenance, so it
   *  stays in the sidecar and never reaches the XMP packet. */
  kept?: string
}

const NS_TRANSOM = 'https://transom.local/ns/1.0/'
const PACKET_ID = 'W5M0MpCehiHzreSzNTczkc9d'

const escape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const unescape = (value: string) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

/**
 * An XMP packet for one image.
 *
 * The caption goes in `dc:description` as well as the private namespace, and
 * that is the whole point of using XMP rather than a PNG text chunk: Preview,
 * Finder and Lightroom read the standard field, and nothing but transom
 * reads `transom:`. `dc:description` is a language alternative rather than a
 * plain string — the spec's shape, and what those readers expect.
 */
export function buildXmp(stamp: Stamp): string {
  const attrs = (['zone', 'repo', 'sha'] as const)
    .filter((key) => stamp[key])
    .map((key) => `\n    transom:${key}="${escape(stamp[key]!)}"`)
    .join('')

  const caption = stamp.caption
    ? `\n   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escape(
        stamp.caption,
      )}</rdf:li></rdf:Alt></dc:description>`
    : ''

  return `<?xpacket begin="﻿" id="${PACKET_ID}"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:transom="${NS_TRANSOM}"
    xmp:CreatorTool="transom"${attrs}${
      stamp.caption ? `\n    transom:caption="${escape(stamp.caption)}"` : ''
    }>${caption}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
}

/**
 * The stamp back out of a packet. Reads what `buildXmp` writes — a real XMP
 * document from another tool may say the same things in shapes this does not
 * look for, so a miss means "not ours", never "no caption".
 */
export function readXmp(packet: string): Stamp {
  const out: Stamp = {}
  for (const key of ['caption', 'zone', 'repo', 'sha'] as const) {
    const attr = new RegExp(`transom:${key}="([^"]*)"`).exec(packet)
    if (attr?.[1]) out[key] = unescape(attr[1])
  }
  if (!out.caption) {
    const dc = /<dc:description>.*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/.exec(packet)
    if (dc?.[1]) out.caption = unescape(dc[1])
  }
  return out
}
