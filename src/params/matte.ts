export const MATTE_WHERE = ['off', 'stacks', 'lightbox', 'both'] as const
export type MatteWhere = (typeof MATTE_WHERE)[number]

export type MatteParams = {
  /** A checkerboard behind an image's transparent pixels, so dark ink drawn
   *  for a white page does not vanish into the wall. */
  matte: { where: MatteWhere; opacity: number }
}

export const matteIn = (where: MatteWhere, place: 'stacks' | 'lightbox') =>
  where === 'both' || where === place
