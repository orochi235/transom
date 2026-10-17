import type { WallItem } from './protocol.ts'

/** How many artifacts the wall keeps at once. A guess at a pressure nobody has
 *  felt yet: past it, pinning one more means choosing which pin it replaces. */
export const KEEP_CAP = 12

/** The kept artifacts, longest-kept first. The band draws them in this order
 *  and the menu offers them for replacing in it. */
export const keptOf = <T extends Pick<WallItem, 'keptAt'>>(items: Iterable<T>): T[] =>
  [...items].filter((i) => i.keptAt !== undefined).sort((a, b) => a.keptAt! - b.keptAt!)
