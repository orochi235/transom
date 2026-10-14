import type { PileParams } from '@/params/pile.ts'
import type { AttentionParams } from '@/params/attention.ts'
import type { ArrangementParams } from '@/params/arrangement.ts'
import type { CameraParams } from '@/params/camera.ts'
import type { ParallaxParams } from '@/params/parallax.ts'
import type { SceneParams } from '@/params/scene.ts'
import type { ColorParams } from '@/params/colors.ts'
import type { LodParams } from '@/params/lod.ts'
import { defaultsOf } from '@/schema/defaults.ts'
import { PARAMS } from '@/schema/params.ts'

export type { LodTier } from '@/params/lod.ts'
export type { Projection } from '@/params/camera.ts'
export { INBOX_MODES, type InboxMode } from '@/params/arrangement.ts'
export type { AttentionLevel } from '@/params/attention.ts'

export type StackParams = PileParams
  & AttentionParams
  & ArrangementParams
  & CameraParams
  & ParallaxParams
  & SceneParams
  & ColorParams
  & LodParams

/** The schema holds each param's default beside its range and its name, so
 *  the type above is the only other place the shape is written down. */
export const defaultParams = defaultsOf(PARAMS) as StackParams

/**
 * The demo as a tile embedded in another page (`?embed`), which is a preview
 * and not the app: a wall that plays, not a console. The demo opened at its
 * own address is the wall as it ships.
 *
 * The wall's own oblique orbit reads as depth on a monitor you walk past and as
 * skew in a 16/9 tile nobody can turn, so the tile looks straight down -Z — the
 * projection was always orthographic, so squaring the orbit is what makes the
 * cells rectangles. Its zones sit in one row that holds its scale and runs off
 * the sides rather than shrinking every pile to fit. No band, since every
 * control is something to read before deciding to ignore it, and no orbit,
 * since one flick loses the framing these parameters exist to set.
 */
export const embedParams: StackParams = {
  ...defaultParams,
  camera: {
    ...defaultParams.camera,
    yawDeg: 0,
    pitchDeg: 0,
    // Wider slack at the wall rung than the default 1.08: a pile leans up and
    // left as it deepens, the camera frames the cells rather than the overhang,
    // and in a single row the leftmost pile is the one that leaves the frame.
    margins: [1.3, 1.12],
    homeMargin: 1.3,
    wallShows: 2.4,
  },
  zoneGrid: { ...defaultParams.zoneGrid, rows: 1, cellW: 0.55 },
  // A row of cells is narrower than a grid's, and a pile hung at the cell's
  // top-left corner then leans out past the first cell's left edge — off the
  // frame, since the camera frames the cells and not what overhangs them.
  origin: { x: 0.5, y: 0.5 },
  side: 0.26,
  band: { ...defaultParams.band, shown: false },
  nav: { ...defaultParams.nav, orbit: false, dragCardSetsStep: false },
}
