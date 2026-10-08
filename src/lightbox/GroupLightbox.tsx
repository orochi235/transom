import { useCallback, useEffect, useState } from 'react'
import type { Take, WallItem } from '@shared/protocol.ts'
import { countOf, nextOpen, posterTake } from '@shared/groups.ts'
import { Ask } from '@/lightbox/Ask.tsx'
import { Outs } from '@/lightbox/Outs.tsx'
import { ImageLightbox } from '@/lightbox/ImageLightbox.tsx'

/** One take drawn as the picture it is: the group's own fields, with the take's
 *  pixels and its own name, and its question left to `Ask` to draw. */
function takeItem(item: WallItem, take: Take): WallItem {
  const { kind: _run, takes: _members, question: _q, choices: _c, reply: _r, markup: _m, ...card } = item
  return {
    ...card,
    id: take.id,
    url: take.url,
    origUrl: take.origUrl,
    name: take.name,
    path: take.path,
    bornAt: take.at,
    w: take.w,
    h: take.h,
    ...(take.markup ? { markup: take.markup } : {}),
    ...(take.apps ? { apps: take.apps } : {}),
    ...(take.links ? { links: take.links } : {}),
  }
}

/**
 * A group's carousel: one take at a time, paged with the arrows, each with its
 * own question. Opens on the take the card was drawing — the first unanswered —
 * so the picture the wall was asking about is the one that comes up.
 *
 * Answering advances to the next take still waiting rather than the next take,
 * which is what makes twelve verdicts twelve keystrokes.
 */
export function GroupLightbox({
  item,
  quietMs,
  closing,
  onAnswer,
  onDismiss,
  ...rest
}: {
  item: WallItem
  now: number
  quietMs: number
  closing: boolean
  onClose: () => void
  onAnswer: (answer: { choice?: string; text: string; take: string }) => void
  onDismiss: (take: string) => void
}) {
  const takes = item.takes ?? []
  const [atId, setAtId] = useState(() => posterTake(takes)?.id)
  const found = takes.findIndex((t) => t.id === atId)
  const at = found === -1 ? 0 : found
  const take = takes[at]
  const go = useCallback(
    (by: number) => {
      const next = takes[Math.min(takes.length - 1, Math.max(0, at + by))]
      if (next) setAtId(next.id)
    },
    [takes, at],
  )

  // The arrows page the group rather than leaving the card, the same way the
  // video lightbox claims the space bar: a capture listener, so the wall's own
  // handler never sees the key.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target?.isContentEditable || target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT')
        return
      const by = e.key === 'ArrowLeft' || e.key === 'PageUp' ? -1 : e.key === 'ArrowRight' || e.key === 'PageDown' ? 1 : 0
      if (by === 0) return
      e.preventDefault()
      e.stopPropagation()
      go(by)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go])

  if (!take) return null
  const answer = (answer: { choice?: string; text: string }) => {
    onAnswer({ ...answer, take: take.id })
    // Advanced from what the group will look like once this reply lands, since it
    // has not yet: the take just answered is otherwise still the first open one.
    const closed = takes.map((t) =>
      t.id === take.id ? { ...t, reply: { status: 'answered' as const, text: '', at: Date.now() } } : t,
    )
    const next = nextOpen(closed, take.id)
    if (next) setAtId(next.id)
  }
  return (
    <>
      {/* Keyed, so paging the carousel remounts the picture rather than
          leaving the previous take's zoom and pan over the next one. */}
      <ImageLightbox
        key={take.id}
        {...rest}
        item={takeItem(item, take)}
        closing={closing}
        quietMs={quietMs}
      />
      <Ask
        key={take.id}
        asked={take}
        closing={closing}
        count={countOf(item, at)}
        onAnswer={answer}
        onDismiss={() => {
          onDismiss(take.id)
          const closed = takes.map((t) =>
            t.id === take.id ? { ...t, reply: { status: 'dismissed' as const, text: '', at: Date.now() } } : t,
          )
          const next = nextOpen(closed, take.id)
          if (next) setAtId(next.id)
        }}
      />
      <Outs id={take.id} apps={take.apps} links={take.links} />
      {at > 0 && (
        <button
          type="button"
          className="lightbox__page lightbox__page--prev"
          aria-label="Previous take"
          onClick={(e) => {
            e.stopPropagation()
            go(-1)
          }}
        />
      )}
      {at < takes.length - 1 && (
        <button
          type="button"
          className="lightbox__page lightbox__page--next"
          aria-label="Next take"
          onClick={(e) => {
            e.stopPropagation()
            go(1)
          }}
        />
      )}
    </>
  )
}
