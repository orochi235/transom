export type ParallaxParams = {
  /**
   * The right-click menu's parallax, handed straight to delamin8r. Here rather
   * than in the component because the only way to judge it is to open the menu
   * and move the pointer, which is a drag rather than an edit.
   */
  menu: {
    /** `window` moves the viewpoint and leaves every box where it is, so a
     *  click lands where it was aimed. `tilt` rotates the deck under the
     *  pointer, which reads harder and moves the target while you approach. */
    mode: 'window' | 'tilt'
    /** Z between adjacent planes, px. */
    step: number
    /** How far the viewpoint swings at full deflection, px. */
    swing: number
    /** Degrees the deck turns at full deflection. `tilt` only. */
    tilt: number
  }
  /** The filter band's parallax, handed to delamin8r. It moves only while the
   *  pointer is over the band. */
  band: {
    /** Draw the band at all. Off is a wall with no controls on it — what the
     *  public demo wants, where every control is a thing a stranger has to
     *  read before deciding to ignore it. */
    shown: boolean
    parallax: boolean
    /** Z between adjacent planes, px. */
    step: number
    /** px. delamin8r derives this from the band's width, which leaves a stack
     *  this shallow barely moving. */
    perspective: number
    /** How far the viewpoint swings at full deflection, px. */
    swing: number
  }
  /** The prefs modal's parallax, handed to delamin8r. `window` mode only: the
   *  sheet is a form, and a deck that tilts moves what you are reaching for.
   *  The scrim is the stage, so the sheet itself is a plane and swings against
   *  the wall behind it. */
  prefs: {
    parallax: boolean
    /** Z between adjacent planes, px. Small, and paid for with `swing`: a
     *  plane's travel goes as `swing * z / (perspective - z)` while the
     *  compositing it costs goes as `z / perspective`, so depth bought with
     *  the viewpoint is free where depth bought with Z softens the text. */
    step: number
    /** px. Left to delamin8r this comes off the container, and the scrim is
     *  the viewport. */
    perspective: number
    /** How far the viewpoint swings at full deflection, px. */
    swing: number
  }
}

export const parallaxDefaults: ParallaxParams = {
  menu: {
    mode: 'tilt',
    step: 16,
    swing: 40,
    tilt: 12,
  },
  band: {
    shown: true,
    parallax: true,
    step: 20,
    perspective: 500,
    swing: 80,
  },
  prefs: {
    parallax: true,
    step: 12,
    perspective: 1400,
    swing: 420,
  },
}
