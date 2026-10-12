import { ago } from '@/age.ts'
import { formatClock } from '@shared/duration.ts'
import type { WallItem } from '@shared/protocol.ts'
import { askWords, asksOf } from '@/asks.ts'

/**
 * What the artifact is. A page says so in the wall's own word, because the
 * card it was opened from is a screenshot and the two are easy to confuse;
 * everything else says the format `/orig` will hand over on a save.
 *
 * Null for an artifact whose name carries no extension, which is what expiry
 * renames a file to.
 */
function formatOf(item: WallItem): string | null {
  if (item.kind === 'page') return 'page'
  // A video or a mesh says its container, the same as a picture does: it is what `/orig`
  // hands over on a save, and `video` would say less than `mp4`.
  return item.path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? null
}

/** Sizes as a reader says them: `4.2 MB`, `812 KB`. Two significant places
 *  under ten, none above, because the digit past the point stops meaning
 *  anything at that size. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let unit = 0
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024
    unit++
  }
  return `${unit === 0 || n >= 10 ? Math.round(n) : n.toFixed(1)} ${units[unit]}`
}

/**
 * The line above the image: where it came from, how old it is, what it is,
 * how big it is, and the commit it was made at where `bin/transom` could see one.
 *
 * Parts rather than a string, so the caller can space them and give the zone
 * its color without parsing text back apart.
 */
export function metaOf(item: WallItem, now: number): string[] {
  const parts = [item.zone, ago(now - item.bornAt)]
  if (item.host) parts.push(`from ${item.host}`)
  // Which run a take belongs to, since the carousel shows the take's own name
  // where the card showed the group's.
  if (item.group?.label) parts.push(item.group.label)
  if (item.repo && item.sha && item.repo !== item.zone) parts.push(`${item.repo}@${item.sha}`)
  else if (item.sha) parts.push(item.sha)
  const format = formatOf(item)
  if (format) parts.push(format)
  // The one thing about an animation nobody can count by looking, and the
  // reason the card underneath is a still.
  if (item.frames) parts.push(`${item.frames} frames`)
  // Same job for a video: how much of it there is, which the poster cannot say.
  if (item.duration) parts.push(formatClock(item.duration))
  // How much of it there is, for the one artifact whose pixel size is the
  // poster viewport's rather than its own.
  if (item.bytes) parts.push(formatBytes(item.bytes))
  if (item.kind !== 'mesh' && item.w > 0 && item.h > 0) parts.push(`${item.w}×${item.h}`)
  return parts
}

/**
 * What is true of the artifact right now, as against what it is: kept from the
 * sweeper, flagged, asking a question, asking to be looked at.
 *
 * Apart from `metaOf` because these are read differently. A format and a pixel
 * size are settled facts and a reader scans past them; state is the reason to
 * look at the line at all, and set in the same row in the same ink it reads as
 * one more fact about the file — which is how `kept` sat unnoticed at the end
 * of six of them.
 */
export function statusOf(item: WallItem): string[] {
  const parts: string[] = []
  if (item.keptAt) parts.push('kept')
  if (item.note) parts.push(item.note)
  if (item.attention) parts.push(item.attention.level)
  // In words, since there is room for them here: the wall's own chip is a glyph.
  const asks = asksOf(item)
  if (asks) parts.push(askWords(item, asks))
  if (item.markup?.status === 'pending') parts.push(item.markup.live ? 'marks unsent' : 'marks held')
  // Sent as the answer to the question, the reply above already says so.
  else if (item.markup?.status === 'delivered' && item.markup.via !== 'ask') parts.push('marks sent')
  return parts
}
