import { cornerChip } from '@/asks.ts'
import { groupBadge } from '@shared/groups.ts'
import { formatClock } from '@shared/duration.ts'
import type { WallItem } from '@shared/protocol.ts'

/** Drawn as text, so it wears whatever color emoji font the system has. */
export const PIN_GLYPH = '📌'

/** What a card wears when there is more to the artifact than the wall draws —
 *  an animation, a video, a mesh. The badge is the invitation to open the
 *  lightbox, which plays or turns it. */
export const PLAYS_GLYPH = '▶'
const MESH_GLYPH = '⬡'
/** A card that stands for many pictures rather than one, with how far through
 *  them the poster is. Two sheets, because that is what a group is. */
const GROUP_GLYPH = '⧉'

// What the bottom-left badge reads. A video spends the runtime it
// reported; an animation has none to spend and wears the bare glyph; a
// mesh is not played at all and says so with its own.
export function playsTextOf(items: readonly WallItem[]): Map<string, string> {
  return new Map(
    items
      .filter((i) => i.frames || i.kind === 'video' || i.kind === 'mesh' || i.kind === 'group')
      .map((i) => [
        i.id,
        i.kind === 'group'
          ? `${GROUP_GLYPH} ${groupBadge(i)}`
          : i.kind === 'mesh'
            ? MESH_GLYPH
            : i.duration
              ? `${PLAYS_GLYPH} ${formatClock(i.duration)}`
              : PLAYS_GLYPH,
      ]),
  )
}

// What a card wants, or wanted: a question waiting on a reply, or one that
// has had one. A flag lapses and takes its plate with it, so the plate
// cannot be the only sign that something is waiting -- and it is no sign at
// all that something was, which is what the wall had no way to say.
export function asksTextOf(items: readonly WallItem[]) {
  return new Map(
    items.flatMap((i) => {
      const chip = cornerChip(i)
      return chip ? [[i.id, chip] as const] : []
    }),
  )
}
