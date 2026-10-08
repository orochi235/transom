import { useFrame, useThree } from '@react-three/fiber'
import type { Dispatch } from 'react'
import * as THREE from 'three'
import type { Rect } from 'windease'
import type { Arrangement, TransomChannels } from '@/arrangements/index.ts'
import { setResolution } from '@/backends/fatLines.ts'
import { poseAt } from '@/camera/move.ts'
import { toStackItems } from '@/model.ts'
import { inZoneOrder, zoneOrder } from '@/nav/sort.ts'
import type { StackParams } from '@/params.ts'
import { rampAt, rampTo } from '@/ramp.ts'
import { stackFor } from '@/typeface.ts'
import { cardOf, depthOf, type ViewAction, type ViewState, zoneOf } from '@/view-state.ts'
import type { Level } from '@shared/attention.ts'
import { badgeFrame, placeBadge, shelfOf } from '@/backends/webgl/badges.ts'
import { asksTextOf, playsTextOf } from '@/backends/webgl/cardText.ts'
import { layOut } from '@/backends/webgl/layOut.ts'
import { placeCornerChips } from '@/backends/webgl/cornerChips.ts'
import { applyPose } from '@/backends/webgl/pose.ts'
import { seekPlates } from '@/backends/webgl/seekPlates.ts'
import type { useBounds } from '@/backends/webgl/useBounds.ts'
import type { useCardTextures } from '@/backends/webgl/useCardTextures.ts'
import type { Chrome } from '@/backends/webgl/useChrome.ts'
import type { Looks } from '@/backends/webgl/useLooks.ts'
import type { WallState } from '@/backends/webgl/useWallState.ts'

/** A textured card takes no tint; the map is the color. */
const WHITE = new THREE.Color(0xffffff)

export function useWallFrame({
  s,
  chrome,
  looks,
  textures,
  drawBounds,
  retarget,
  awakeUntil,
  params,
  view,
  arrangement,
  dispatch,
  onPlan,
  onOffWall,
  dimmed,
  showBounds,
  sidebarInset,
  topInset,
}: {
  s: WallState
  chrome: Chrome
  looks: Looks
  textures: ReturnType<typeof useCardTextures>
  drawBounds: ReturnType<typeof useBounds>['draw']
  retarget: (depth: number, zone: string | null) => void
  awakeUntil: { current: number }
  params: StackParams
  view: ViewState
  arrangement: Arrangement
  dispatch: Dispatch<ViewAction>
  onPlan: Parameters<typeof layOut>[0]['onPlan']
  onOffWall: (count: number) => void
  dimmed: ReadonlySet<string>
  showBounds: boolean
  sidebarInset: { current: number }
  topInset: { current: number }
}) {
  const { gl, camera, invalidate } = useThree()
  const { latest, meshes, hovered, viewRef, zoneById, bases, cardsByZone, revealed } = s
  const { seekAt, plateAt, plateMotion, liveRef, setLive, move, pose } = s
  const { edges, badges, chips, chipRamp, pins, plays, asks, leaders } = chrome
  const { fontsReady, levelColors, flagged, blank, huedColors } = looks
  const cardEdges = params.overlay.cardEdges
  const cardEdgeColor = params.colors.cardEdge
  const badgeFamily = stackFor(params.typeface.badge)
  const huedCardEdge = params.zones.huedCardEdge

  useFrame((_state, delta) => {
    const current = latest.current
    let springing = false
    const now = Date.now() + current.clockOffset
    const model = inZoneOrder(
      toStackItems(current.items, { now, ttlMs: current.ttlMs }, current.dimmed),
      zoneOrder(current.items, current.sort, now, current.heldZones),
    )
    const aspects = new Map(model.map((m) => [m.id, m.aspect]))
    // Real elapsed time, not the decay clock: keeping an artifact freezes how
    // it fades, and a chip that froze with it would report the wrong day.
    const bornAt = new Map(current.items.map((i) => [i.id, i.bornAt]))
    const pinned = new Set(current.items.filter((i) => i.keptAt).map((i) => i.id))
    const playsText = playsTextOf(current.items)
    const asksText = asksTextOf(current.items)
    // A chip annotates its subject, so it shrinks when the camera closes on
    // one: at wall distance the pile is small and the note has to carry, and
    // zoomed in the card is what grew. Ramped over the camera's own move, so
    // the two arrive together instead of the chip snapping mid-flight.
    chipRamp.current = rampTo(
      chipRamp.current,
      zoneOf(viewRef.current) ? params.chips.shrink : 1,
      now,
      params.camera.moveMs,
    )
    const chipHeight =
      params.chips.size * rampAt(chipRamp.current, now, params.camera.moveMs)
    const zoneFor = new Map(model.map((m) => [m.id, m.zone]))
    zoneById.current = zoneFor

    const { result, channels, tick, fronts } = layOut({
      s,
      arrangement,
      params,
      textures,
      model,
      zoneFor,
      current,
      now,
      onPlan,
      onOffWall,
    })

    const { shelf, noLeader } = shelfOf(cardsByZone, flagged, channels, params)
    const leaderPoints = new Map<Level, number[]>()

    // Where the plates go, solved on a cadence rather than per frame: the
    // answer moves with the camera, and re-asking every frame would have them
    // crawling around the wall while it turns. Reads the meshes as the last
    // frame left them, which is a frame stale and invisible at this rate.
    const nowMs = performance.now()
    if (
      params.attention.seek &&
      params.attention.float &&
      nowMs - seekAt.current > params.attention.seekMs
    ) {
      seekAt.current = nowMs
      seekPlates({ s, badges, params, camera, shelf, sidebarInset, topInset })
    }

    const frame = badgeFrame(params, camera, meshes)
    const plates = {
      params,
      badges,
      bases,
      zoneFor,
      shelf,
      noLeader,
      plateAt,
      plateMotion,
      leaderPoints,
      levelColors,
      badgeFamily,
      fontsReady,
      delta,
      frame,
    }
    const corners = {
      params,
      chips,
      pins,
      plays,
      asks,
      chipHeight,
      badgeFamily,
      fontsReady,
      now,
      bornAt,
      pinned,
      playsText,
      asksText,
      fronts,
    }

    const liveZones = [...new Set(model.map((m) => m.zone))]
    const focused = zoneOf(view)
    const focusedCard = cardOf(view)
    // Not before the daemon has answered: a view restored from the URL names a
    // zone the empty wall of the first frames does not have yet.
    if (
      current.connected &&
      ((focused && !liveZones.includes(focused)) ||
        (focusedCard && !model.some((m) => m.id === focusedCard)))
    ) {
      dispatch({ type: 'prune', live: liveZones, cards: model.map((m) => m.id) })
    }

    const placed = [...result.placements.keys()]
    const changed =
      placed.length !== liveRef.current.length || placed.some((id, i) => liveRef.current[i] !== id)
    if (changed) {
      liveRef.current = placed
      setLive(placed)
    }

    for (const [id, rect] of result.placements as Map<string, Rect>) {
      const mesh = meshes.current.get(id)
      if (!mesh) continue
      const ch = channels.get(id) ?? ({} as TransomChannels)
      const aspect = aspects.get(id) ?? 1
      const side = rect.w

      // The rect is the square slot; the image is fit inside it.
      const drawnW = aspect >= 1 ? side : side * aspect
      const drawnH = aspect >= 1 ? side / aspect : side
      const emphasis = ch.emphasis ?? 0
      const flag = flagged.get(id)
      const tier = params.attention.levels[flag?.level ?? 'look']
      // Breathing, so a flag is findable on a wall the eye is scanning. Scaled
      // by emphasis, so an unflagged artifact is exactly as still as it ever was.
      const pulse =
        1 +
        params.attention.pulse *
          tier.pulseAmp *
          emphasis *
          Math.sin((tick / 1000) * 2 * Math.PI * tier.pulseHz)
      // In place, so hovering never reorders what is in front of what.
      const swell = hovered.current === id && emphasis > 0 ? params.attention.hoverScale : 1
      mesh.scale.set(drawnW * pulse * swell, drawnH * pulse * swell, 1)
      mesh.userData.drawnW = drawnW
      mesh.userData.drawnH = drawnH
      // A rect's x/y is its top-left, three positions a plane by its center, and
      // windease's rect space grows y downward where three's world grows it up.
      // All three corrections happen here and nowhere else.
      //
      // The lift is measured in ranks and travels the pile's own axis, which is
      // the (step.x, step.y, step.z) diagonal rather than world z. Adding it to
      // z alone shears the card out of the line its pile is drawn along: head-on
      // that is invisible, and the moment the wall is turned the flagged card
      // sits beside its stack instead of in front of it.
      const rise = tier.lift * emphasis
      mesh.position.set(
        rect.x + drawnW / 2 - rise * params.step.x,
        -(rect.y + drawnH / 2) + rise * params.step.y,
        rect.z + rise * params.step.z,
      )
      mesh.rotation.set(ch.rotX ?? 0, ch.rotY ?? 0, ch.rotZ ?? 0)

      const mat = mesh.material as THREE.MeshBasicMaterial
      const tex = textures.textureFor(id) ?? null
      if (mat.map !== tex) {
        mat.map = tex
        mat.needsUpdate = true
      }
      // three's default is white, which is the brightest thing on the wall. A
      // card waiting for its decode has to read as a slot, not as a picture.
      const tint = tex ? WHITE : blank
      if (!mat.color.equals(tint)) mat.color.copy(tint)
      const cut = (dimmed.has(id) ? params.overlay.filterDim : 1) * revealed.current
      mat.opacity = (ch.opacity ?? 1) * cut
      mat.transparent = true

      const { wearsBadge, springing: springs } = placeBadge(plates, {
        id,
        mesh,
        rect,
        side,
        drawnW,
        drawnH,
        emphasis,
        flag,
        swell,
        pulse,
        cut,
      })
      if (springs) springing = true

      placeCornerChips(corners, { id, mesh, drawnW, drawnH, swell, cut })

      // Set here rather than in the memo, which cannot see a zone that arrived
      // since, and which does not know how far the card has faded.
      const edge = edges.byId.get(id)
      if (edge) {
        // The halo wins the line where both want it: a flagged card is not
        // also reporting its slot extent. A card wearing a plate wears the
        // plate's color on its border too, so the two read as one thing.
        const halo = (emphasis > 0 || wearsBadge) && tier.haloWidth > 0
        edge.visible = halo || cardEdges
        const zone = zoneFor.get(id)
        const own = huedCardEdge && zone ? huedColors.get(zone) : undefined
        if (halo) edge.material.color.set(levelColors[flag?.level ?? 'look'])
        else if (own) edge.material.color.copy(own)
        else edge.material.color.set(cardEdgeColor)
        const thicken = hovered.current === id ? params.attention.hoverEdge : 1
        // No thinner than `soon`'s when it is there to match a plate: the
        // `look` halo alone is the ordinary card edge in another color.
        const haloWidth = wearsBadge
          ? Math.max(tier.haloWidth, params.attention.levels.soon.haloWidth)
          : tier.haloWidth
        edge.material.linewidth = halo ? haloWidth * thicken : params.overlay.cardEdgeWidth
        // The halo is the one thing the depth falloff must not mute.
        edge.material.opacity =
          (halo ? Math.max(ch.opacity ?? 1, emphasis, flag?.inert ? 0.5 : 0) : (ch.opacity ?? 1)) * cut
        setResolution(edge.material, gl)
      }
    }

    for (const [level, line] of leaders) {
      const points = leaderPoints.get(level)
      line.visible = !!points
      if (!points) continue
      line.geometry.setPositions(points)
      // setPositions leaves the instance count from whichever frame had the
      // most segments, so a frame with fewer draws past the end of its own
      // buffer. Six numbers is one segment: two endpoints.
      line.geometry.instanceCount = points.length / 6
      line.material.color.set(levelColors[level])
      line.material.linewidth = params.attention.leaderWidth
      setResolution(line.material, gl)
    }

    retarget(depthOf(view), zoneOf(view))
    if (move.current) pose.current = poseAt(move.current, performance.now())

    drawBounds(showBounds, meshes, gl)

    applyPose(camera, pose.current, params.camera, window.innerWidth / window.innerHeight)

    const moving =
      (move.current !== null && performance.now() - move.current.startedAt < move.current.durationMs) ||
      now - chipRamp.current.startedAt < params.camera.moveMs ||
      revealed.current < 1 ||
      springing ||
      (params.attention.pulse > 0 && flagged.size > 0)
    if (moving || performance.now() < awakeUntil.current) invalidate()
  })
}
