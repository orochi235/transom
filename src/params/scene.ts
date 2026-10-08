import type { Typeface } from '@/typeface.ts'
import type { Backdrop } from '@shared/backdrops.ts'

export type SceneParams = {
  /** The faces text drawn into the scene wears. One per use rather than one
   *  for the wall: a zone name is a heading read at a distance and a badge is
   *  signage read up close, and the face that serves one need not serve the
   *  other. `chrome` is the DOM's: every panel, sheet and menu reads it. */
  typeface: { label: Typeface; badge: Typeface; chrome: Typeface }
  /** Diagnostics drawn into the scene. Debug today, likely furniture later. */
  overlay: {
    /** Outline each card, so a slot's real extent is visible against its image. */
    cardEdges: boolean
    /** Screen pixels. Real widths need fat lines; WebGL ignores linewidth. */
    cardEdgeWidth: number
    /** What an artifact the filter excludes fades to. Not zero: the point of
     *  dimming rather than removing is that you can still see how much you
     *  cut. It does not keep its place in the pile — excluded artifacts rank
     *  behind every kept one, so the pile closes over the gap. */
    filterDim: number
  }
  /** How a zone presents itself, beyond the cards standing in it. */
  zones: {
    /** Outline each zone's drawn extent. */
    outline: boolean
    /** Screen pixels, like the card outline's. */
    outlineWidth: number
    /** Name each zone in the scene. */
    labels: boolean
    /** World height of a label's text — its thickness, since the label is
     *  turned a quarter turn and climbs the cell's left edge. */
    labelSize: number
    /** How far the label sits outside its cell's border, in world units.
     *  Negative brings it inside. */
    labelOffset: number
    /** Where the label sits across the cell, 0..1. 0 is hard against the left
     *  border, 1 against the right — so this is what moves a turned label off
     *  the edge it climbs and across the pile. */
    labelAlign: number
    /** What fills a zone's cell behind its pile. */
    backdrop: Backdrop
    /** Borrow the color of the project bound to a zone, where it has a
     *  `.hued`. Falls back to the palette for every zone that has none. */
    /** The zone's frame — its outline, its name and its count — in the color
     *  of the project bound to it. One switch, because three parts of one frame
     *  disagreeing about whose zone this is reads as a bug. */
    huedFrame: boolean
    huedBackdrop: boolean
    huedCardEdge: boolean
    /** Floor under a project color's lightness. A `.hued` background is picked
     *  to sit behind an editor's text, so some are near-black — weasel's is
     *  #470013 — and unlifted they read as no color at all on this wall. */
    huedMinLight: number
    /** 0 is invisible, 1 is flat. */
    backdropOpacity: number
    /** World distance between hatch lines, and how wide a line is. Both are
     *  world units rather than cell fractions, so the hatch reads at one
     *  density across the wall however the cells are sized. */
    hatchSpacing: number
    /** How long one repeat of a pattern that has a second axis runs — the
     *  zigzag of `chevron`, the wave of `waves`. Every other pattern is ruled
     *  at `hatchSpacing` both ways and never reads this. */
    hatchPeriod: number
    hatchWidth: number
    hatchAngleDeg: number
  }
  /**
   * A cosmetic layer behind everything. Decoration, so the one constraint is
   * that it must not compete with the cards: they are the content and most of
   * them are dark.
   */
  sky: {
    enabled: boolean
    /** Degrees of sky across the screen's height. Not the camera's own fov: an
     *  orthographic camera's rays are parallel, so borrowing the projection
     *  would sample one direction and paint the screen flat. */
    spreadDeg: number
    /** Cycles of the first noise octave across a radian of sky. */
    scale: number
    octaves: number
    /** Ceiling on how far the glow travels from the base color. */
    intensity: number
    /** Pulls the clouds away from the empty sky between them. */
    contrast: number
    starDensity: number
    starIntensity: number
  }
}

export const sceneDefaults: SceneParams = {
  typeface: {
    label: 'oxanium',
    badge: 'oxanium',
    chrome: 'oxanium',
  },
  overlay: {
    cardEdges: false,
    cardEdgeWidth: 1,
    filterDim: 0.12,
  },
  zones: {
    outline: true,
    outlineWidth: 1.5,
    labels: true,
    labelSize: 0.05,
    labelOffset: 0.01,
    labelAlign: 0,
    backdrop: 'hatch',
    huedFrame: true,
    huedBackdrop: true,
    huedCardEdge: true,
    huedMinLight: 0.34,
    backdropOpacity: 0.69,
    hatchSpacing: 0.015,
    hatchPeriod: 0.03,
    hatchWidth: 0.002,
    hatchAngleDeg: 46,
  },
  sky: {
    enabled: true,
    spreadDeg: 90,
    scale: 1.6,
    octaves: 4,
    intensity: 0.45,
    contrast: 1.7,
    starDensity: 0.35,
    starIntensity: 0.5,
  },
}
