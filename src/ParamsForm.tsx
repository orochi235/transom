import { useMemo } from 'react'
import type { PrefGroup } from '@weasel-js/prefs'
import { PrefsForm, Select, type PrefRenderer } from '@weasel-js/ui'
import type { Backdrop } from '@shared/backdrops.ts'
import { BackdropRuling } from '@/BackdropRuling.tsx'
import { BackdropSwatches } from '@/BackdropSwatches.tsx'
import { setAt } from '@/params.paths.ts'
import type { StackParams } from '@/params.ts'
import { BACKDROP, type PrefChoice } from '@/schema/kinds.ts'
import { PARAMS } from '@/schema/params.ts'
import './params.css'

/** The controls for the kinds the wall draws itself. */
function renderersFor(
  params: StackParams,
  onChange: (next: StackParams) => void,
): Record<string, PrefRenderer> {
  const ruling = {
    spacing: params.zones.hatchSpacing,
    period: params.zones.hatchPeriod,
    angle: params.zones.hatchAngleDeg,
  }
  return {
    [BACKDROP]: ({ pref, value, setValue }) => (
      <>
        <BackdropSwatches
          label={pref.name}
          value={value as Backdrop}
          tint="currentColor"
          onChange={setValue}
        />
        <BackdropRuling
          backdrop={value as Backdrop}
          own={ruling}
          wall={ruling}
          // The wall has nothing above it, so a row here never clears — a
          // null would leave the uniform unset.
          onChange={(patch) => {
            let next = params
            if (patch.spacing != null) next = setAt(next, 'zones.hatchSpacing', patch.spacing)
            if (patch.period != null) next = setAt(next, 'zones.hatchPeriod', patch.period)
            if (patch.angle != null) next = setAt(next, 'zones.hatchAngleDeg', patch.angle)
            onChange(next)
          }}
        />
      </>
    ),
    choice: ({ pref, value, setValue, disabled }) => (
      <Select
        aria-label={pref.name}
        value={String(value)}
        isDisabled={disabled}
        options={(pref as PrefChoice).options.map((n) => ({ value: String(n), label: String(n) }))}
        onChange={(raw) => setValue(Number(raw))}
      />
    ),
  }
}

/**
 * Params drawn from a schema: the whole of `PARAMS`, or a layout of pointers
 * into it. The sidebar and the prefs sheet both draw through here, so a param
 * reads the same wherever it is shown.
 */
export function ParamsForm({
  schema = PARAMS,
  params,
  onChange,
}: {
  schema?: PrefGroup
  params: StackParams
  onChange: (next: StackParams) => void
}) {
  const renderers = useMemo(() => renderersFor(params, onChange), [params, onChange])
  return (
    <PrefsForm
      className="params__form wzl-skin"
      schema={schema}
      over={schema === PARAMS ? undefined : PARAMS}
      values={params}
      layout="list"
      renderers={renderers}
      onChange={(path, value) => onChange(setAt(params, path, value as number | string | boolean))}
    />
  )
}
