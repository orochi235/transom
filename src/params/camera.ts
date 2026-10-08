export type Projection = 'orthographic' | 'perspective'

export type CameraParams = {
  camera: {
    projection: Projection
    /**
     * How much world width the wall rung shows, instead of fitting whatever is
     * on it. Set, a zone holds its size as zones arrive and the row runs off
     * the sides, where a horizontal scroll, a drag of the sky or the wall
     * cursor reaches it. Undefined fits the wall, which is what a board on one
     * monitor wants.
     */
    wallShows?: number
    /** Perspective only. */
    fovDeg: number
    /** Orthographic only: how far off the wall the camera sits. Scale-neutral
     *  under an orthographic projection, so it only has to clear the deepest
     *  card the rank cap allows. */
    standoff: number
    /** Where the camera sits on its orbit around what it frames. 0,0 looks
     *  straight down -Z; yaw swings right, pitch rises. */
    yawDeg: number
    pitchDeg: number
    /** Slack around the framed box, one entry per rung from the wall down; the
     *  last entry serves every rung past it, so a deeper hierarchy costs no new
     *  parameter. 1 is exactly framed. */
    margins: number[]
    /** How far out the reset button frames the wall: the wall rung's margin
     *  it restores. A margin rather than a distance, because an orthographic
     *  camera's distance changes nothing you can see. */
    homeMargin: number
    /** How much further out one wheel step past the wall frames it, as a
     *  multiple of the wall's own margin. Renamed from `zoomOutSpace` so a
     *  saved panel stops holding the old default. */
    zoomOutRoom: number
    /** How long a level change takes. */
    moveMs: number
  }
  /** Walking the hierarchy by wheel and pinch. */
  nav: {
    /** Charge a scroll must accumulate to move a rung. */
    wheelThreshold: number
    /** The same for a pinch, whose deltas run an order of magnitude smaller. */
    pinchThreshold: number
    /** A silence this long ends a wheel gesture. One gesture is worth one rung,
     *  so a flick's tail cannot walk the hierarchy behind the hand. */
    quietMs: number
    /** The least time between rungs — one rung per tick of the wheel, however
     *  hard it is spun. The gate stops a flick's tail; this paces a sustained
     *  stream and a pinch, which carries no tail to gate. */
    floorMs: number
    /** A drag turns the wall. Off holds the camera where the parameters put
     *  it: the rungs still walk in and out, but nothing can be flung loose. */
    orbit: boolean
    /** A drag begun on a card moves its pile instead of turning the wall.
     *  Turning still works from the sky and the gaps between piles. */
    dragCardSetsStep: boolean
    /** World units of depth per wheel notch while a card is being dragged. A
     *  drag can only ever reach the two axes facing the camera, so this is the
     *  way to the third without orbiting to find it. */
    dragDepthPerNotch: number
  }
}

export const cameraDefaults: CameraParams = {
  camera: {
    projection: 'orthographic',
    fovDeg: 35,
    standoff: 18,
    yawDeg: 23.8720703125,
    pitchDeg: -15.578125,
    margins: [
      1.08,
      1.12,
    ],
    homeMargin: 1.08,
    zoomOutRoom: 1.5,
    moveMs: 520,
  },
  nav: {
    wheelThreshold: 60,
    pinchThreshold: 8,
    quietMs: 90,
    floorMs: 800,
    orbit: true,
    dragCardSetsStep: true,
    dragDepthPerNotch: 0.0006,
  },
}
