import { useCallback, useEffect, useMemo, useState } from 'react'
import { actions } from '@/actions.ts'
import type { FakeFlag } from '@/debug-flags.ts'
import type { Props } from '@/backends/webgl/types.ts'

export function useFakeFlags(props: Pick<Props, 'items'>, card: string | null) {
  // Flags the wall never received, merged in below. Held here rather than in
  // App so that a fake reaches the scene by exactly the route a real one does.
  const [fakes, setFakes] = useState<Record<string, FakeFlag>>({})

  const items = useMemo(() => {
    if (Object.keys(fakes).length === 0) return props.items
    return props.items.map((i) => {
      const fake = fakes[i.id]
      return fake ? { ...i, attention: fake.attention, note: fake.note } : i
    })
  }, [props.items, fakes])

  const dropFake = useCallback((id: string) => {
    setFakes((was) => {
      if (!(id in was)) return was
      const { [id]: _gone, ...rest } = was
      return rest
    })
  }, [])

  // Opening a card is the thing the flag was asking for, so looking at it is
  // what clears it. Fire-and-forget: the daemon broadcasts the change, and a
  // dismissal that fails costs a halo that is still accurate. Not a card with
  // a question on it, which only an explicit dismiss closes.
  const openedAsks = items.find((i) => i.id === card)?.question !== undefined
  useEffect(() => {
    if (card === null) return
    dropFake(card)
    if (openedAsks) return
    actions.dismiss(card)
  }, [card, openedAsks, dropFake])

  // The daemon has no record of a fabricated flag, so the row's × has to clear
  // it here; a real one still goes the one route that exists for it.
  const dismiss = useCallback(
    (id: string) => {
      dropFake(id)
      actions.dismiss(id, 'close')
    },
    [dropFake],
  )

  return { items, fakes, setFakes, dismiss }
}
