/**
 * What a zone's cell is ruled with, behind its cards. `none` draws nothing and
 * `solid` a flat tint; the rest are line art, ruled in world space so they read
 * at one density across the wall.
 *
 * Shared rather than client-side because a zone may override the wall's choice,
 * and the daemon holds that override — see `server/zones.ts`. How each one is
 * drawn stays with the drawing: `src/backdrops.ts` for the shader, `Minimap`
 * for the ones SVG can.
 */
export const BACKDROPS = [
  'none',
  'solid',
  'hatch',
  'crosshatch',
  'grid',
  'chevron',
  'waves',
  'bricks',
  'basketweave',
  'parquet',
  'triangles',
  'hexagons',
  'scales',
  'dragonscale',
  'dots',
  'checks',
  'argyle',
  'rosette',
  'braid',
] as const

export type Backdrop = (typeof BACKDROPS)[number]

export const isBackdrop = (v: unknown): v is Backdrop =>
  typeof v === 'string' && (BACKDROPS as readonly string[]).includes(v)
