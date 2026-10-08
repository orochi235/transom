import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { replyWords } from '@/asks.ts'
import { liftedTint } from '@/nav/zone-tint.ts'
import type { StackParams } from '@/params.ts'
import { loadFaces } from '@/typeface.ts'
import type { Level } from '@shared/attention.ts'
import type { WallItem } from '@shared/protocol.ts'

export function useLooks(items: WallItem[], params: StackParams, zoneColors: Record<string, string>) {
  // Canvas text falls back silently for a face the document has not finished
  // loading, so everything drawn to a canvas is rebuilt once they are in.
  const [fontsReady, setFontsReady] = useState(false)
  useEffect(() => {
    let live = true
    void loadFaces().then(() => live && setFontsReady(true))
    return () => {
      live = false
    }
  }, [])

  const levelColors: Record<Level, string> = {
    look: params.colors.attentionLook,
    soon: params.colors.attentionSoon,
    urgent: params.colors.attentionUrgent,
    problem: params.colors.attentionProblem,
  }
  // Which artifacts are asking, and what their badges say. Off the items
  // rather than the channels: a level is a name and a note is a sentence,
  // and `TransomChannels` carries numbers.
  // A closed question keeps a badge that no longer asks: the question and
  // what it got, with no emphasis behind it.
  const flagged = useMemo(() => {
    const out = new Map<string, { level: Level; note?: string; inert?: true }>()
    for (const i of items) {
      if (i.attention) {
        out.set(i.id, { level: i.attention.level, ...(i.note ? { note: i.note } : {}) })
      } else if (i.question && i.reply) {
        const got = i.reply.status === 'answered' ? i.reply.text.split('\n')[0] : replyWords(i.reply)
        out.set(i.id, { level: 'look', note: `${i.question} → ${got}`, inert: true })
      }
    }
    return out
  }, [items])
  const blank = useMemo(() => new THREE.Color(params.colors.cardBlank), [params.colors.cardBlank])
  // Parsed once per color rather than per card per frame.
  const huedMinLight = params.zones.huedMinLight
  const huedColors = useMemo(() => {
    const out = new Map<string, THREE.Color>()
    for (const [zone, css] of Object.entries(zoneColors)) {
      const color = liftedTint(css, huedMinLight)
      if (color) out.set(zone, color)
    }
    return out
  }, [zoneColors, huedMinLight])
  return { fontsReady, levelColors, flagged, blank, huedColors }
}

export type Looks = ReturnType<typeof useLooks>
