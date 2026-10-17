import type { LayoutResult, Rect } from 'windease'
import { keptOf } from '@shared/keep.ts'
import { createGlides } from './glide.ts'
import { edgeFor } from './inbox.ts'
import { ramp } from './slots.ts'
import type { StackItem } from '@/model.ts'
import type { StackParams } from '@/params.ts'
import type { Arrangement, Size, TransomChannels } from './types.ts'

/** The channel that marks a card as standing in the kept band rather than in
 *  whatever the arrangement drew. */
export const IN_KEPT_BAND = 'kept'

/** The room the flowing set is laid out in, which the band takes its share of
 *  only while something is kept. */
export const flowBox = (container: Size, params: StackParams, anyKept: boolean): Size =>
  anyKept ? { w: container.w, h: container.h * (1 - params.kept.height) } : container

/**
 * Kept cards leave the flowing set for a band along the wall's bottom edge, and
 * the arrangement lays out what is left in the space above it — one rule for
 * every arrangement, rather than each packing around a hole. With nothing kept
 * the arrangement has the whole wall and the band takes no room.
 */
export function withKeptBand(inner: Arrangement, params: StackParams): Arrangement {
  const cfg = params.kept
  const glides = createGlides()
  /** Where each flowing card stood last frame, so one just kept slides down
   *  out of its pile rather than appearing in the band. */
  let lastFlow = new Map<string, Rect>()

  return {
    ...inner,
    strategy: {
      name: inner.strategy.name,
      layout(input): LayoutResult {
        const all = input.items as StackItem[]
        const kept = keptOf(all)
        if (kept.length === 0) {
          const out = inner.strategy.layout(input)
          lastFlow = out.placements as Map<string, Rect>
          glides.keep(new Set())
          return out
        }
        const now = typeof input.options.now === 'number' ? input.options.now : Date.now()
        const { w, h } = input.container
        const flow = flowBox(input.container, params, true)
        const bandH = h - flow.h
        const out = inner.strategy.layout({
          ...input,
          items: all.filter((i) => i.keptAt === undefined),
          container: flow,
        })

        const n = kept.length
        const side = Math.max(0, Math.min(bandH - 2 * cfg.gap, (w - cfg.gap * (n + 1)) / n))
        const x0 = (w - (n * side + (n - 1) * cfg.gap)) / 2
        const y = h - bandH + (bandH - side) / 2
        const placements = new Map(out.placements as Map<string, Rect>)
        const channels = new Map(out.channels ?? [])
        const ids = new Set<string>()
        kept.forEach((it, i) => {
          ids.add(it.id)
          const to: Rect = { x: x0 + i * (side + cfg.gap), y, z: 0, w: side, h: side }
          placements.set(it.id, glides.at(it.id, to, now, params.inbox.moveMs, lastFlow.get(it.id)))
          channels.set(it.id, {
            z: 0,
            // Age is frozen at the keep, so this is the fade it had then.
            opacity: 1 - ramp(it.age01, params.fade.from, params.fade.to),
            rotX: 0,
            rotY: 0,
            rotZ: 0,
            lod: edgeFor(side),
            emphasis: it.emphasis,
            [IN_KEPT_BAND]: 1,
          } satisfies TransomChannels & { [IN_KEPT_BAND]: number })
        })
        glides.keep(ids)
        lastFlow = out.placements as Map<string, Rect>
        return { ...out, placements, channels }
      },
    },
  }
}
