import { useRef, useState } from 'react'
import { defaultParams, type StackParams } from '@/params.ts'
import { fromText, toText } from '@/params.transfer.ts'
import './params.css'

/**
 * Moving a tuned set in and out. The clipboard is the fast path — what is
 * copied pastes straight into `src/params.ts` — and the file is for keeping a
 * few named sets around, which the clipboard cannot.
 */
export function ParamsTransfer({
  params,
  onChange,
}: {
  params: StackParams
  onChange: (next: StackParams) => void
}) {
  const [note, setNote] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const flash = (text: string) => {
    setNote(text)
    setTimeout(() => setNote(''), 1400)
  }

  const apply = (text: string) => {
    const next = fromText(defaultParams, text)
    if (!next) return flash('not params')
    onChange(next)
    flash('loaded')
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toText(params))
      flash('copied')
    } catch {
      flash('clipboard refused')
    }
  }

  const paste = async () => {
    try {
      apply(await navigator.clipboard.readText())
    } catch {
      flash('clipboard refused')
    }
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([toText(params)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'transom-params.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="params__transfer">
      <button type="button" className="params__button" onClick={copy}>
        copy
      </button>
      <button type="button" className="params__button" onClick={paste}>
        paste
      </button>
      <button type="button" className="params__button" onClick={download}>
        save
      </button>
      <button type="button" className="params__button" onClick={() => picker.current?.click()}>
        load
      </button>
      <span className="params__note">{note}</span>
      <input
        ref={picker}
        className="params__file"
        type="file"
        accept="application/json,.json"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          // Cleared so picking the same file twice in a row still fires.
          e.target.value = ''
          if (file) apply(await file.text())
        }}
      />
    </div>
  )
}
