import type { Box } from '@/nav/whitespace.ts'
import { SIDES, type Group, type Placement } from './placement.ts'
import { SCREEN, scoreLayout, type Weights } from './score.ts'

const same = (a: Placement, b: Placement) => a.side === b.side && a.ring === b.ring

/**
 * Where every group stands next. Coordinate descent from a handful of seeds:
 * the layout the wall holds, and one per side with every pile on it, so a
 * shared side is always on the table. The wall keeps what it has unless the
 * best of them is better by `settle`; a pile that has just gained its first
 * plate is placed against the held layout rather than shaking it.
 */
export function solve(
  obstacles: readonly Box[],
  cells: readonly { zone: string; box: Box }[],
  groups: readonly Group[],
  weights: Weights,
  usable: Box = SCREEN,
): { picks: Placement[]; score: number } {
  const total = (picks: number[]) => scoreLayout(obstacles, cells, groups, picks, weights, usable)
  const indexOf = (group: Group, want: Placement) =>
    group.candidates.findIndex((c) => same(c, want))
  const alone = (g: number): number => {
    // Cheapest on its own, for a group with nowhere to start from.
    const lone = groups.map(() => -1)
    let best = 0
    let bestScore = Infinity
    for (let c = 0; c < (groups[g]?.candidates.length ?? 0); c++) {
      lone[g] = c
      const s = total(lone)
      if (s < bestScore) {
        bestScore = s
        best = c
      }
    }
    return best
  }

  const descend = (picks: number[]): number => {
    let best = total(picks)
    for (let sweep = 0; sweep < 8; sweep++) {
      let improved = false
      for (let g = 0; g < groups.length; g++) {
        let was = picks[g] ?? 0
        for (let c = 0; c < (groups[g]?.candidates.length ?? 0); c++) {
          if (c === was) continue
          picks[g] = c
          const s = total(picks)
          if (s < best - 1e-9) {
            best = s
            was = c
            improved = true
          } else picks[g] = was
        }
      }
      if (!improved) break
    }
    return best
  }

  const heldIdx = groups.map((group) => (group.held ? indexOf(group, group.held) : -1))
  const complete = groups.length > 0 && heldIdx.every((i) => i >= 0)
  const heldSeed = heldIdx.map((i, g) => (i >= 0 ? i : alone(g)))

  let baseline: { picks: number[]; score: number }
  if (complete) baseline = { picks: [...heldIdx], score: total(heldIdx) }
  else {
    const picks = [...heldSeed]
    baseline = { picks, score: descend(picks) }
  }

  let best = complete ? (() => {
    const picks = [...heldSeed]
    return { picks, score: descend(picks) }
  })() : baseline
  for (const side of SIDES) {
    const picks = groups.map((group, g) => {
      const i = indexOf(group, { side, ring: 1 })
      return i >= 0 ? i : heldSeed[g] ?? 0
    })
    const s = descend(picks)
    if (s < best.score - 1e-9) best = { picks, score: s }
  }

  const chosen = best.score < baseline.score * (1 - weights.settle) - 1e-9 ? best : baseline
  return {
    picks: chosen.picks.map((c, g) => {
      const candidate = groups[g]?.candidates[c]
      return candidate ? { side: candidate.side, ring: candidate.ring } : { side: 'welded', ring: 1 }
    }),
    score: chosen.score,
  }
}
