export type ColorParams = {
  /**
   * Every color the wall picks, in one place so a theme has one surface to
   * drive. Alpha variants are derived in CSS with `color-mix`, so one entry
   * here covers all of its uses rather than one entry per declaration.
   */
  colors: {
    /** Drawn into the scene, and turning with it. */
    cardEdge: string
    /** A card whose texture has not landed yet. Sat near the sky on purpose:
     *  three's default is white, and a wall of white quads turning into
     *  pictures reads as the artifacts arriving one at a time. */
    cardBlank: string
    /** One per attention level, run near-neon: a badge competes with whatever
     *  the artifact itself is showing, and a muted plate loses. `look` sits
     *  outside the traffic-light ramp on purpose — it is not a severity, so it
     *  must not read as the low end of one, and nothing else here uses green. */
    attentionLook: string
    attentionSoon: string
    attentionUrgent: string
    attentionProblem: string
    /** Badge text. Black on every plate: they all run near-neon, and even pure
     *  red measures better against black (5.25:1) than against white (4.00:1).
     *  Renamed from `badgeInk` so a panel saved with white stops overriding it. */
    flagInk: string
    /** A corner chip: a black plate, so it reads against a picture of any
     *  color, with the clock struck in yellow so the glyph is findable at a
     *  glance and the text stays the thing being read. */
    chipFill: string
    chipIcon: string
    chipInk: string
    zoneIdle: string
    zoneFocus: string
    zoneBackdrop: string
    label: string
    /** The empty sky, and the nebula the glow reaches toward. Stars derive
     *  from the glow rather than earning a third entry. */
    skyBase: string
    skyGlow: string
    /** The DOM chrome: panel, HUD, plan view, lightbox. */
    bg: string
    scrim: string
    ink: string
    muted: string
    accent: string
    danger: string
  }
}

export const colorDefaults: ColorParams = {
  colors: {
    cardEdge: '#22d3ee',
    cardBlank: '#0b1020',
    attentionLook: '#00ff00',
    attentionSoon: '#ffff00',
    attentionUrgent: '#ff8000',
    attentionProblem: '#ff0000',
    flagInk: '#000000',
    chipFill: '#000000',
    chipIcon: '#ffe58f',
    chipInk: '#ffffff',
    zoneIdle: '#64748b',
    zoneFocus: '#38bdf8',
    zoneBackdrop: '#64748b',
    label: '#e2e8f0',
    skyBase: '#05060a',
    skyGlow: '#2b3f6b',
    bg: '#0a0a0c',
    scrim: '#000000',
    ink: '#e2e8f0',
    muted: '#94a3b8',
    accent: '#38bdf8',
    danger: '#e0796b',
  },
}
