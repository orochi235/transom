import { useMemo } from 'react'
import { Slider } from '@weasel-js/ui'
import { Panel } from '@/panel/index.ts'
import { ago } from '@/age.ts'
import { BUCKETS, bucketRange, filterFrom, histogram, resolve, spanOf, type Filter } from '@/nav/time-filter.ts'
import type { WallItem } from '@shared/protocol.ts'

const BINS = 64

export function TimePanel({
  items,
  now,
  range,
  onRange,
}: {
  items: readonly WallItem[]
  /** The daemon's clock, so the axis agrees with every age on the wall. */
  now: number
  range: Filter | null
  onRange: (next: Filter | null) => void
}) {
  const bornAts = useMemo(() => items.map((i) => i.bornAt), [items])
  const span = useMemo(() => spanOf(bornAts, now), [bornAts, now])
  const bins = useMemo(() => histogram(bornAts, span, BINS), [bornAts, span])
  const tallest = Math.max(1, ...bins)

  const resolved = resolve(range, now)
  const value: [number, number] = [resolved?.from ?? span.from, resolved?.to ?? span.to]
  const step = Math.max(1000, Math.round((span.to - span.from) / 400))

  return (
    <Panel name="time">
      {/* Out of the stack, not just off its own plane: a control nested two
          planes deep is hit-tested a dozen px from where it paints, and the
          range picker's thumb is 6px wide, so the grab misses every time. */}
      <div className="topbar__chart" data-dl-skip>
        <Slider
          className="topbar__range wzl-skin"
          thumbs={[{ value: value[0] }, { value: value[1] }]}
          min={span.from}
          max={span.to}
          step={step}
          constraint="ordered"
          trackClick="move-nearest"
          trackHeight={34}
          readoutPlacement="none"
          ariaLabel="Time range"
          onInput={(next) => onRange(filterFrom(next[0].value, next[1].value, span, step))}
          renderTrack={() => (
            /* The shape of the day, so a burst is something you can see
               before you go looking for it. Drawn inside the track rather
               than beside it, so the bars and the thumbs cannot land on
               different widths. */
            <svg
              className="topbar__hist"
              viewBox={`0 0 ${BINS} 100`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {bins.map((n, i) => {
                const start = span.from + ((span.to - span.from) * i) / BINS
                const inside = !resolved || (start >= resolved.from && start <= resolved.to)
                return (
                  <rect
                    key={i}
                    className={`topbar__bar ${inside ? '' : 'topbar__bar--out'}`}
                    x={i}
                    y={100 - (n / tallest) * 100}
                    width={0.86}
                    height={(n / tallest) * 100}
                  />
                )
              })}
            </svg>
          )}
        />
      </div>

      <div className="topbar__scale">
        <span>{ago(now - span.from)} ago</span>
        <span>now</span>
      </div>

      {/* Under the span they set, where a preset reads as a shortcut to a
          range rather than as a filter of its own. */}
      <div className="topbar__buckets">
        {BUCKETS.map((bucket) => {
          const b = bucketRange(bucket.key)
          const on = !!range && range.fromAgo === b.fromAgo && range.toAgo === 0
          return (
            <button
              key={bucket.key}
              type="button"
              className="topbar__bucket"
              aria-pressed={on}
              onClick={() => onRange(on ? null : b)}
            >
              {bucket.label}
            </button>
          )
        })}
      </div>
    </Panel>
  )
}
