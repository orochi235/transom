/**
 * The density to rasterize an SVG at so its thumbnail's long edge reaches
 * `maxEdge`. sharp draws an SVG at 72 dpi, its own declared size, and the
 * resize after it never enlarges — so a 40-px icon would land on the wall as a
 * 40-px blur where any other picture gets a full-size thumbnail.
 */
export function vectorDensity(size: { w: number; h: number } | null, maxEdge: number): number {
  const long = size ? Math.max(size.w, size.h) : 0
  if (!long) return 72
  // librsvg's own ceiling is far above this; this one keeps a 1-px-wide
  // drawing from asking for a raster the size of a billboard.
  return Math.min(72 * 64, Math.max(72, (72 * maxEdge) / long))
}
