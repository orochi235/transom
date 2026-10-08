/** Clear of its own card, so the plate never z-fights the border it sits on. */
export const BADGE_LIFT = 0.002

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
