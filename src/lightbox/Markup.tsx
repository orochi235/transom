import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  ANNOTATION_TOOLS,
  AnnotationOverlay,
  createAnnotationStore,
  type AnnotationTargetInfo,
  type SerializedAnnotations,
} from '@weasel-js/labkit'
import {
  SurfaceCanvasContext,
  SurfaceContext,
  useTiledSurface,
  type SurfaceFrame,
} from '@weasel-js/labkit/surface'
import { registerCanvasFont } from '@weasel-js/core'
import { Icon } from '@weasel-js/ui'
import type { Size } from '@/lightbox/view.ts'

// A text mark is laid out in weasel's default family, which draws nothing
// until some font tier serves it. A lab registers one; this is the wall's.
registerCanvasFont('sans-serif')

/** The one target this surface carries: the picture. */
const TARGET = 'render'

/** What the rail offers. Line and ellipse are left off: an arrow and a box say
 *  everything they would, and fewer buttons is a shorter reach. */
const TOOL_IDS = ['stroke', 'arrow', 'rect', 'text', 'select'] as const
const TOOLS = ANNOTATION_TOOLS.filter((t) => (TOOL_IDS as readonly string[]).includes(t.id))

export type MarkedUp = { png: Blob; marks: SerializedAnnotations; text: string }

/** Where the picture is drawn, in window pixels. */
export type Box = { x: number; y: number; w: number; h: number }

/**
 * Drawing on a picture, and handing the drawing back flattened onto it.
 *
 * labkit's annotation overlay, hosted outside a lab: this component owns the
 * shared surface a lab would — a container the tile rects are measured against
 * and the one buffer marks paint into — so the overlay mounts as it would in a
 * trial. The marks live in the picture's own content box at its on-screen
 * size, so a stroke is as thick here as it will look, and the capture scales
 * the lot up to the original's pixels.
 */
export function Markup({
  src,
  box,
  natural,
  sending,
  failed,
  onSend,
  onCancel,
}: {
  src: string
  box: Box
  natural: Size
  sending: boolean
  /** The last send was refused or never arrived. */
  failed: boolean
  onSend: (marked: MarkedUp) => void
  onCancel: () => void
}) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const bufferRef = useRef({ w: 0, h: 0 })
  const surfaceRef = useRef<ReturnType<typeof useTiledSurface> | null>(null)
  const [tool, setTool] = useState<string>('stroke')
  const [text, setText] = useState('')
  const [count, setCount] = useState(0)
  const tile = useRef<HTMLDivElement | null>(null)
  const shell = useRef<HTMLDivElement | null>(null)
  const bar = useRef<HTMLFormElement | null>(null)

  // Sizing the buffer clears it, so every tile repaints — the same thing a
  // lab does for its own surface.
  const onFrame = useCallback((frame: SurfaceFrame) => {
    const c = canvasRef.current
    if (!c) return
    const w = Math.round(frame.size.width * frame.dpr)
    const h = Math.round(frame.size.height * frame.dpr)
    if (bufferRef.current.w === w && bufferRef.current.h === h) return
    bufferRef.current = { w, h }
    c.width = w
    c.height = h
    surfaceRef.current?.invalidateAll()
  }, [])
  const surface = useTiledSurface({ onFrame })
  surfaceRef.current = surface
  const canvases = useMemo(() => ({ over: canvas, under: null }), [canvas])

  const content = useMemo(
    () => ({ w: Math.max(1, Math.round(box.w)), h: Math.max(1, Math.round(box.h)) }),
    [box.w, box.h],
  )
  const info = useRef<AnnotationTargetInfo>({ id: TARGET, content })
  info.current = { id: TARGET, content, base: () => ({ kind: 'image', src }) }
  const store = useMemo(() => createAnnotationStore({ targets: () => [info.current] }), [])
  const scene = useMemo(() => store.sceneFor(TARGET), [store])
  // A text mark draws its title, and the overlay makes one with none: the
  // words are asked for where it was put down, and a mark left wordless goes.
  const [naming, setNaming] = useState<{ id: string; x: number; y: number } | null>(null)
  const [words, setWords] = useState('')
  useEffect(
    () =>
      store.subscribe(() => {
        const all = store.query()
        setCount(all.filter((a) => a.kind !== 'text' || a.title).length)
        const bare = all.find((a) => a.kind === 'text' && !a.title)
        setNaming((was) => (was || !bare ? was : { id: bare.id, x: bare.frac.x, y: bare.frac.y }))
      }),
    [store],
  )
  const name = (keep: boolean) => {
    if (!naming) return
    if (keep && words.trim() !== '') store.update(naming.id, { title: words.trim() })
    else store.remove(naming.id)
    setNaming(null)
    setWords('')
  }

  // Nothing the wall listens for may reach it while a drawing is open: Delete
  // expires the card, Escape closes the lightbox, the arrows page away, and
  // each would take the marks with it. Keys aimed at the drawing are stopped
  // on their way out of it, below; this swallows the rest before they start.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as Node | null
      if (target && (shell.current?.contains(target) || bar.current?.contains(target))) return
      if ((target as Element | null)?.closest?.('input, textarea, [contenteditable]')) return
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const send = async () => {
    if (sending || count === 0) return
    const result = await store.capture(TARGET, { format: 'png', scale: natural.w / content.w })
    onSend({ png: result.blob, marks: store.toJSON(), text: text.trim() })
  }

  return (
    <>
      <div
        className="markup"
        ref={(el) => {
          shell.current = el
          surface.containerRef(el)
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <canvas
          className="markup__surface"
          ref={(el) => {
            canvasRef.current = el
            setCanvas(el)
          }}
        />
        <div
          className="markup__target"
          ref={tile}
          style={
            {
              '--mk-x': `${box.x}px`,
              '--mk-y': `${box.y}px`,
              '--mk-w': `${box.w}px`,
              '--mk-h': `${box.h}px`,
            } as CSSProperties
          }
        />
        {naming && (
          <input
            className="markup__words"
            autoFocus
            value={words}
            placeholder="note"
            aria-label="Note text"
            style={
              {
                '--mk-x': `${box.x + naming.x * box.w}px`,
                '--mk-y': `${box.y + naming.y * box.h}px`,
              } as CSSProperties
            }
            onChange={(e) => setWords(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') name(true)
              if (e.key === 'Escape') name(false)
            }}
            onBlur={() => name(true)}
          />
        )}
        <SurfaceContext.Provider value={surface}>
          <SurfaceCanvasContext.Provider value={canvases}>
            <AnnotationOverlay
              target={{ ...info.current, ref: tile }}
              scene={scene}
              config={null}
              activeToolId={tool}
            />
          </SurfaceCanvasContext.Provider>
        </SurfaceContext.Provider>
      </div>
      <form
        className="markup__bar"
        ref={bar}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          e.stopPropagation()
        }}
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <div className="markup__tools" role="toolbar" aria-label="Drawing tools">
          {TOOLS.map((t) => (
            <button
              type="button"
              key={t.id}
              className="markup__tool"
              aria-label={t.label}
              title={t.label}
              aria-pressed={tool === t.id}
              onClick={() => setTool(t.id)}
            >
              <Icon name={t.icon} />
            </button>
          ))}
          <button
            type="button"
            className="markup__tool markup__undo"
            disabled={!store.canUndo()}
            onClick={() => store.undo()}
          >
            undo
          </button>
        </div>
        {failed && <span className="markup__failed">not sent</span>}
        <input
          className="markup__text"
          value={text}
          placeholder="what should change?"
          aria-label="What should change"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="lightbox__choice" disabled={sending || count === 0}>
          No, like this
        </button>
        <button type="button" className="lightbox__skip" onClick={onCancel}>
          cancel
        </button>
      </form>
    </>
  )
}
