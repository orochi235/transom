import { useEffect, useRef, useState } from 'react'
import type { Reply } from '@shared/protocol.ts'
import { replyWords } from '@/asks.ts'

/** What a question is, wherever it hangs: on a card, or on one take of a group. */
export type Asked = {
  question?: string
  choices?: string[]
  why?: string
  reply?: Reply
}

/**
 * The agent's question, over whichever kind of lightbox is open.
 *
 * The chip is the submit: clicking one — or pressing its number — sends the
 * verdict with whatever is in the comment box, empty or not. Text alone cannot
 * send, which is what makes advancing through a group unambiguous. A question
 * with no choices at all is the older shape and still a text box where Enter
 * sends and Shift+Enter breaks the line.
 *
 * Once it has a reply it stays, inert, showing what it got.
 */
export function Ask({
  asked,
  closing,
  count,
  onAnswer,
  onDismiss,
}: {
  asked: Asked
  closing: boolean
  /** `3/12` while a group is being reviewed; absent for a card's own question. */
  count?: string
  onAnswer: (answer: { choice?: string; text: string }) => void
  onDismiss: () => void
}) {
  const [text, setText] = useState('')
  const typed = useRef('')
  typed.current = text
  const { question, choices, reply } = asked
  const open = question !== undefined && reply === undefined

  // The number keys, which the wall would otherwise read as its own. Held off
  // a text field unless a modifier is down: a digit typed into the comment box
  // is part of the comment, so `3` lands there and ⌘3 still votes.
  useEffect(() => {
    if (!open || !choices) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.altKey) return
      const target = e.target as HTMLElement | null
      const typing =
        target?.isContentEditable || target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT'
      if (typing !== (e.metaKey || e.ctrlKey)) return
      if (e.key === '0') {
        e.preventDefault()
        e.stopPropagation()
        onDismiss()
        return
      }
      const at = Number(e.key) - 1
      if (!Number.isInteger(at) || at < 0 || at >= choices.length) return
      e.preventDefault()
      e.stopPropagation()
      onAnswer({ choice: choices[at]!, text: typed.current })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, choices, onAnswer, onDismiss])

  if (question === undefined) return null
  if (reply) {
    return (
      <div className="lightbox__ask" data-closed="" data-closing={closing ? '' : undefined}>
        <p className="lightbox__question">{question}</p>
        {choices && reply.status === 'answered' ? (
          <div className="lightbox__answers">
            {choices.map((choice) => (
              <span
                className="lightbox__choice"
                key={choice}
                data-chosen={choice === reply.choice ? '' : undefined}
              >
                {choice}
              </span>
            ))}
          </div>
        ) : null}
        {reply.status === 'answered' && reply.text ? (
          <p className="lightbox__reply lightbox__reply--closed">{reply.text}</p>
        ) : null}
        {reply.status === 'marked' && reply.text ? (
          <p className="lightbox__reply lightbox__reply--closed">{reply.text}</p>
        ) : null}
        {reply.status !== 'answered' ? (
          <p className="lightbox__reply lightbox__reply--closed">{replyWords(reply)}</p>
        ) : (
          !choices && !reply.text && <p className="lightbox__reply lightbox__reply--closed">answered</p>
        )}
      </div>
    )
  }
  const box = choices ? asked.why : ''
  const send = () => {
    if (text.trim() !== '') onAnswer({ text })
  }
  return (
    // Neither a click nor a keystroke here is the wall's: a click would close
    // the lightbox, and `[` typed into the answer would change arrangement.
    <form
      className="lightbox__ask"
      data-closing={closing ? '' : undefined}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') e.stopPropagation()
      }}
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      {count && <span className="lightbox__count">{count}</span>}
      <p className="lightbox__question">{question}</p>
      {box !== undefined && (
        <textarea
          className="lightbox__reply"
          value={text}
          rows={2}
          placeholder={box || undefined}
          autoFocus={!choices}
          aria-label={choices ? 'Comment' : 'Answer'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') return e.currentTarget.blur()
            if (e.key === 'Enter' && !e.shiftKey && !choices) {
              e.preventDefault()
              send()
            }
          }}
        />
      )}
      <div className="lightbox__answers">
        {choices ? (
          choices.map((choice, at) => (
            <button
              type="button"
              className="lightbox__choice"
              key={choice}
              onClick={() => onAnswer({ choice, text })}
            >
              {choice}
              {at < 9 && <span className="lightbox__key">{at + 1}</span>}
            </button>
          ))
        ) : (
          <button type="submit" className="lightbox__choice" disabled={text.trim() === ''}>
            send
          </button>
        )}
        {/* Set off from the chips: dropping one without a verdict is not one of
            the outcomes, so it is not a key among them either. */}
        <button type="button" className="lightbox__skip" onClick={onDismiss}>
          dismiss
          {choices && <span className="lightbox__key">0</span>}
        </button>
      </div>
    </form>
  )
}
