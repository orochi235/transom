import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { createLoop, loopPositions } from '@/backends/fatLines.ts'
import { CHROME_ORDER } from '@/backends/order.ts'
import { rampOf } from '@/ramp.ts'
import { badgeTexture } from '@/textures/badge.ts'
import { createChips } from '@/textures/chip.ts'
import { LEVELS, type Level } from '@shared/attention.ts'

export function useChrome() {
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  // A unit square the card mesh's own scale stretches to the drawn image, so
  // the outline needs none of the position corrections the card needed.
  // One loop per card. The unit square is stretched by the card's own scale,
  // and the width stays in screen pixels regardless — which is the point of a
  // width slider.
  const edges = useMemo(() => {
    const byId = new Map<string, ReturnType<typeof createLoop>>()
    return {
      byId,
      for(id: string) {
        let line = byId.get(id)
        if (!line) {
          line = createLoop()
          line.geometry.setPositions(loopPositions(-0.5, -0.5, 0.5, 0.5))
          byId.set(id, line)
        }
        return line
      },
    }
  }, [])
  useEffect(
    () => () => {
      for (const line of edges.byId.values()) {
        line.geometry.dispose()
        line.material.dispose()
      }
      edges.byId.clear()
    },
    [edges],
  )

  const badges = useMemo(() => {
    const quad = new THREE.PlaneGeometry(1, 1)
    const byId = new Map<string, { plate: THREE.Mesh; key: string; w: number; h: number }>()
    return {
      quad,
      byId,
      /** Rebuilt only when what it draws changes, so a per-frame call is free. */
      sync(
        id: string,
        key: string,
        text: string,
        fill: string,
        ink: string,
        font: string,
        lineHeight: number,
        maxWidth: number,
      ) {
        let held = byId.get(id)
        if (!held) {
          // A plane rather than a sprite, so the badge lies in its artifact's
          // own plane and turns with the wall. A sprite always faces the
          // camera, which peeled it off the card as soon as the scene rotated.
          const plate = new THREE.Mesh(
            quad,
            // Signage, not scenery: it composites over the wall rather than
            // sorting into it, so a nearer pile cannot bury the thing that is
            // asking to be looked at.
            new THREE.MeshBasicMaterial({
              transparent: true,
              depthTest: false,
              depthWrite: false,
              toneMapped: false,
              side: THREE.DoubleSide,
            }),
          )
          plate.renderOrder = CHROME_ORDER
          // The badge is a shortcut to its own artifact, so it takes a pick.
          plate.userData.transomId = id
          plate.userData.transomBadge = true
          held = { plate, key: '', w: 0, h: 0 }
          byId.set(id, held)
        }
        if (held.key !== key) {
          const material = held.plate.material as THREE.MeshBasicMaterial
          material.map?.dispose()
          const { texture, width, height } = badgeTexture(
            text,
            fill,
            ink,
            font,
            lineHeight,
            maxWidth,
          )
          material.map = texture
          material.needsUpdate = true
          held.key = key
          held.w = width
          held.h = height
        }
        return held
      },
    }
  }, [])
  const chips = useMemo(() => createChips(), [])
  const chipRamp = useRef(rampOf(1))
  const pins = useMemo(() => createChips(), [])
  const plays = useMemo(() => createChips(), [])
  const asks = useMemo(() => createChips(), [])
  useEffect(() => () => chips.dispose(), [chips])
  useEffect(() => () => pins.dispose(), [pins])
  useEffect(() => () => plays.dispose(), [plays])
  useEffect(() => () => asks.dispose(), [asks])

  /** One line object per level rather than one per badge: a LineMaterial has a
   *  single color, and four draw calls is cheaper than one per flag. */
  const leaders = useMemo(() => {
    const byLevel = new Map<Level, LineSegments2>()
    for (const level of LEVELS) {
      const line = createLoop()
      line.material.depthTest = false
      line.material.depthWrite = false
      line.renderOrder = CHROME_ORDER
      byLevel.set(level, line)
    }
    return byLevel
  }, [])
  useEffect(
    () => () => {
      for (const line of leaders.values()) {
        line.geometry.dispose()
        line.material.dispose()
      }
    },
    [leaders],
  )

  useEffect(
    () => () => {
      for (const { plate } of badges.byId.values()) {
        const material = plate.material as THREE.MeshBasicMaterial
        material.map?.dispose()
        material.dispose()
      }
      badges.quad.dispose()
      badges.byId.clear()
    },
    [badges],
  )
  return { geometry, edges, badges, chips, chipRamp, pins, plays, asks, leaders }
}

export type Chrome = ReturnType<typeof useChrome>
