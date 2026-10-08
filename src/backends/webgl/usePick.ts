import { useThree } from '@react-three/fiber'
import { type Dispatch, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { cardHit, zoneAt } from '@/nav/pick.ts'
import { clickToward, stepToward } from '@/nav/step.ts'
import type { ViewAction } from '@/view-state.ts'
import type { Chrome } from '@/backends/webgl/useChrome.ts'
import type { WallState } from '@/backends/webgl/useWallState.ts'

export function usePick(
  s: WallState,
  badges: Chrome['badges'],
  dispatch: Dispatch<ViewAction>,
  onPrefs: () => void,
) {
  const { gl, camera } = useThree()
  const { meshes, bases, zoneById, zoneLabels, cells, cardsByZone, viewRef } = s
  /** Set by the pick when what it hit was flagged, read and cleared by the
   *  navigate that follows it. */
  const jumpTo = useRef<readonly string[] | null>(null)
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const zeroPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), [])

  /** The card the raycaster's current ray picks, its badge counting as the
   *  card. The base under the pointer owns the pick (`cardHit`). */
  const cardUnder = (): string | undefined => {
    const targets: THREE.Object3D[] = [...meshes.current.values()]
    for (const { plate } of badges.byId.values()) if (plate.visible) targets.push(plate)
    const point = new THREE.Vector3()
    const owner = raycaster.ray.intersectPlane(zeroPlane, point)
      ? zoneAt({ x: point.x, y: -point.y }, bases.current)
      : null
    const hit = cardHit(
      raycaster.intersectObjects(targets, false),
      (h) => zoneById.current.get(h.object.userData.transomId as string),
      owner,
    )
    return hit?.object.userData.transomId as string | undefined
  }

  /**
   * The full path under the pointer — the pile, plus the card if one is hit.
   * A card is a mesh and a pile is not: its footprint is hit-tested against the
   * cells behind, which answers for a pile with no cards in it and needs no
   * invisible plane fighting the pile's own depth for the pick.
   */
  const chainAt = (clientX: number, clientY: number): string[] => {
    const rect = gl.domElement.getBoundingClientRect()
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    )

    // A label draws over everything, depth test and all, so it takes the
    // pick where it overlaps a card: what is on top is what was clicked. Its
    // whole quad counts, which is the point — the gaps between the letters are
    // not holes.
    for (const [zone, sprite] of zoneLabels.current) {
      if (!sprite.visible) continue
      if (raycaster.intersectObject(sprite, false).length > 0) return [zone]
    }

    const id = cardUnder()
    const hitZone = id ? zoneById.current.get(id) : undefined
    if (id && hitZone) {
      // A card is a destination, not a rung: hitting one goes straight to its
      // artifact rather than spending the gesture descending a level at a time.
      // A pile's own footprint still steps, which is what reaches a zone. The
      // badge and the card it is welded to behave identically.
      jumpTo.current = [hitZone, id]
      return [hitZone, id]
    }

    const point = new THREE.Vector3()
    if (!raycaster.ray.intersectPlane(zeroPlane, point)) return []
    // The renderer is the only place that undoes windease's downward y.
    const zone = zoneAt({ x: point.x, y: -point.y }, cells.current)
    return zone ? [zone] : []
  }

  /**
   * The artifact under the pointer, or null — what the cursor reads, and what
   * a click would open. A badge counts as part of its own artifact's frame: it
   * is welded to the border, so hitting it means hitting the card.
   *
   * Its own test rather than a read of `chainAt`, which answers with a path for
   * the whole wall and reports a zone where there is no card at all.
   */
  const hoverAt = (clientX: number, clientY: number): string | null => {
    if (meshes.current.size === 0) return null

    const rect = gl.domElement.getBoundingClientRect()
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    )
    return cardUnder() ?? null
  }

  /** One rung per gesture: across if the cursor is over another branch, down
   *  otherwise. Both the click and the wheel spend themselves through here. */
  const navigate = (chain: readonly string[]) => {
    const jump = jumpTo.current
    jumpTo.current = null
    if (jump) return void dispatch({ type: 'to', path: jump })
    const next = stepToward(viewRef.current.path, chain)
    if (next) dispatch({ type: 'to', path: next })
  }

  /** How many ranks back a card sits in its own pile, or null if the pointer
   *  is not over one. The divisor that turns a dragged card into a per-rank
   *  step — and the front card, at rank 0, has nothing to spread over. */
  const rankAt = (clientX: number, clientY: number): number | null => {
    const chain = chainAt(clientX, clientY)
    const zone = chain[0]
    const id = chain[1]
    if (!zone || !id) return null
    const rank = cardsByZone.current.get(zone)?.indexOf(id) ?? -1
    return rank < 0 ? null : rank
  }

  /** Where a click lands, which at the wall is the zone's top card rather than
   *  a rung. Held beside `navigate` so the listener sees this render's view. */
  const clickAt = (chain: readonly string[]) =>
    clickToward(viewRef.current.path, chain, (zone) => cardsByZone.current.get(zone)?.[0])

  // Held by ref so the listeners below bind once and still see this render's
  // view: rebinding a wheel listener would drop the gesture rail's charge.
  const act = useRef({ chainAt, navigate, hoverAt, rankAt, onPrefs, clickAt })
  act.current = { chainAt, navigate, hoverAt, rankAt, onPrefs, clickAt }
  return act
}

export type Act = ReturnType<typeof usePick>
