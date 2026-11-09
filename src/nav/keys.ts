import type { Direction } from '@/nav/neighbor.ts'
import { SORTS, type SortKey } from '@/nav/sort.ts'

/**
 * WASD and the arrows are the same four directions. PageUp/PageDown page a
 * pile wherever left and right do, so cycling a stack does not depend on
 * which hand is on which key.
 */
const KEYS: Record<string, Direction> = {
  arrowleft: 'left',
  arrowright: 'right',
  arrowup: 'up',
  arrowdown: 'down',
  a: 'left',
  d: 'right',
  w: 'up',
  s: 'down',
  pageup: 'left',
  pagedown: 'right',
}

export type KeySample = {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
}

/**
 * The direction a keystroke asks for, or null for one that is not the wall's.
 *
 * A modifier disqualifies it: Cmd-W belongs to the browser, and a wall that
 * navigates on the way to closing its own tab is worse than one that ignores
 * the key. Shift does not, since a capital W is still W.
 */
export function directionFor(e: KeySample): Direction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null
  return KEYS[e.key.toLowerCase()] ?? null
}

/**
 * Whether a keystroke asks to go in. Enter and space both, because every list
 * a person has ever opened a row in has meant one of them; the wall's Escape
 * is the way back out.
 *
 * A modifier disqualifies it for the reason it disqualifies a direction.
 */
export function opensIn(e: KeySample): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false
  return e.key === 'Enter' || e.key === ' '
}

/**
 * Whether a keystroke asks to delete the open card. Both keys, because the one
 * a Mac labels delete sends Backspace.
 *
 * A modifier disqualifies it for the reason it disqualifies a direction.
 */
export function deletes(e: KeySample): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false
  return e.key === 'Backspace' || e.key === 'Delete'
}

/** Whether a keystroke turns paging the wall as one list on or off. */
export function togglesList(e: KeySample): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false
  return e.key.toLowerCase() === 'l'
}

/** Whether a keystroke steps which arrivals an open lightbox follows. */
export function cyclesFollow(e: KeySample): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false
  return e.key.toLowerCase() === 'f'
}

/**
 * Whether a keystroke was aimed at a control rather than at the wall. An arrow
 * steps a focused slider and a letter lands in a field; either way the wall
 * must not also move, which is the trap WASD walks into that the arrows only
 * grazed.
 */
export function isForAControl(target: EventTarget | null): boolean {
  const el = target as Element | null
  return !!el?.closest?.('input, select, textarea, button, [contenteditable]')
}

/**
 * The sort a function key asks for, by position in the band's own list — so a
 * fourth sort gets F4 without a second place to remember. Function keys
 * because the wall's letters are already WASD.
 *
 * A modifier disqualifies it for the reason it disqualifies a direction.
 */
export function sortFor(e: KeySample): SortKey | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null
  const at = /^F([1-9])$/.exec(e.key)
  if (!at) return null
  return SORTS[Number(at[1]) - 1]?.key ?? null
}
