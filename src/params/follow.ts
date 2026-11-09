import type { WallItem } from '@shared/protocol.ts'

export const FOLLOW_MODES = ['off', 'stack', 'any'] as const
export type FollowMode = (typeof FOLLOW_MODES)[number]

export type FollowParams = {
  /** Whether an open lightbox jumps to an artifact as it lands: only one in
   *  the zone it is showing, or any at all. */
  follow: { arrivals: FollowMode }
}

/** The mode after this one, for the key and the band row that step through them. */
export const nextFollow = (mode: FollowMode): FollowMode =>
  FOLLOW_MODES[(FOLLOW_MODES.indexOf(mode) + 1) % FOLLOW_MODES.length]

/** Whether a lightbox open on a card in `openZone` moves to `arrived`. */
export function follows(mode: FollowMode, openZone: string, arrived: WallItem): boolean {
  if (mode === 'any') return true
  return mode === 'stack' && arrived.zone === openZone
}
