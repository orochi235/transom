import * as THREE from 'three'
import type { Rect } from 'windease'
import type { TransomChannels } from '@/arrangements/index.ts'
import type { StackParams } from '@/params.ts'
import type { Level } from '@shared/attention.ts'
import { BADGE_LIFT } from '@/backends/webgl/constants.ts'
import { drawLeader } from '@/backends/webgl/leader.ts'
import type { Chrome } from '@/backends/webgl/useChrome.ts'
import type { Looks } from '@/backends/webgl/useLooks.ts'
import type { WallState } from '@/backends/webgl/useWallState.ts'

type Flag = Looks['flagged'] extends Map<string, infer F> ? F : never

export function shelfOf(
  cardsByZone: WallState['cardsByZone'],
  flagged: Looks['flagged'],
  channels: Map<string, TransomChannels>,
  params: StackParams,
) {
  // Which shelf slot each floating badge takes, the front of the pile first.
  // Assigned over the pile rather than per card, because the collision this
  // fixes is between two plates that belong to different cards.
  const shelf = new Map<string, number>()
  // The bottom plate of a pile whose front card is the flagged one is already
  // sitting on that card: it gets no line, because there is nothing for a
  // line to disambiguate. Only a plate that has had to climb needs one.
  const noLeader = new Set<string>()
  if (params.attention.float) {
    for (const ids of cardsByZone.current.values()) {
      let slot = 0
      for (const id of ids) {
        const flag = flagged.get(id)
        if (!flag?.note) continue
        if (!flag.inert && (channels.get(id)?.emphasis ?? 0) <= 0) continue
        if (slot === 0 && id === ids[0]) noLeader.add(id)
        shelf.set(id, slot++)
      }
    }
  }
  return { shelf, noLeader }
}

export function badgeFrame(params: StackParams, camera: THREE.Camera, meshes: WallState['meshes']) {
  // A badge lies in its card's plane, turning with the wall, or faces the
  // camera whatever the wall does. Its offsets are measured in the same frame
  // it is drawn in, so the two agree from every angle.
  const unturn = new THREE.Quaternion()
  const orient = (plate: THREE.Object3D, card: THREE.Object3D): void => {
    if (params.attention.billboard) plate.quaternion.copy(camera.quaternion)
    else plate.rotation.copy(card.rotation)
  }
  // Billboarded badges all stand on one plane, just in front of the nearest
  // card, so no badge is ever behind a card from another pile. Moved along
  // its own line of sight, which leaves it where it was on screen. Reads the
  // meshes and the camera as the last frame left them.
  const viewDir = camera.getWorldDirection(new THREE.Vector3())
  let frontDepth = Infinity
  if (params.attention.billboard) {
    for (const m of meshes.current.values()) {
      if (!m.visible) continue
      const d = m.position.x * viewDir.x + m.position.y * viewDir.y + m.position.z * viewDir.z
      if (d < frontDepth) frontDepth = d
    }
  }
  const eyeDepth = camera.position.dot(viewDir)
  const planeDepth = frontDepth - BADGE_LIFT - eyeDepth
  const toPlane = (p: THREE.Vector3): void => {
    if (!params.attention.billboard || !Number.isFinite(planeDepth)) return
    const d = p.dot(viewDir) - eyeDepth
    if (d <= 1e-6 || planeDepth <= 1e-6) return
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      p.sub(camera.position).multiplyScalar(planeDepth / d).add(camera.position)
    } else p.addScaledVector(viewDir, planeDepth - d)
  }
  return { unturn, orient, toPlane }
}

export function placeBadge(
  f: {
    params: StackParams
    badges: Chrome['badges']
    bases: WallState['bases']
    zoneFor: Map<string, string>
    shelf: Map<string, number>
    noLeader: Set<string>
    plateAt: WallState['plateAt']
    plateMotion: WallState['plateMotion']
    leaderPoints: Map<Level, number[]>
    levelColors: Record<Level, string>
    badgeFamily: string
    fontsReady: boolean
    delta: number
    frame: ReturnType<typeof badgeFrame>
  },
  card: {
    id: string
    mesh: THREE.Mesh
    rect: Rect
    side: number
    drawnW: number
    drawnH: number
    emphasis: number
    flag: Flag | undefined
    swell: number
    pulse: number
    cut: number
  },
): { wearsBadge: boolean; springing: boolean } {
  const { params, badges, bases, zoneFor, shelf, noLeader, plateAt, plateMotion, leaderPoints } = f
  const { levelColors, badgeFamily, fontsReady, delta } = f
  const { unturn, orient, toPlane } = f.frame
  const { id, mesh, rect, side, drawnW, drawnH, emphasis, flag, swell, pulse, cut } = card
  let springing = false
  const badge = badges.byId.get(id)
  const wearsBadge = (emphasis > 0 || !!flag?.inert) && !!flag?.note
  if (badge || wearsBadge) {
    const level = flag?.level ?? 'look'
    const fill = levelColors[level]
    const ink = params.colors.flagInk
    // A badge may run past its own artifact's right edge, as far as the
    // next zone begins — a note is worth more than the tidiness of a plate
    // that stops where the picture does.
    const base = zoneFor.get(id) ? bases.current.get(zoneFor.get(id)!) : undefined
    const floats = params.attention.float && shelf.has(id) && !!base
    // A floating plate is measured from its zone's left edge, where the
    // shelf stands. Measuring from the card would give a deep rank almost
    // no width at all, since its rect has already stepped most of the way
    // across the cell.
    const runsFrom = floats && base ? base.x : rect.x
    const runsTo = base ? base.x + base.w + params.zoneGrid.gap : rect.x + side
    const held = badges.sync(
      id,
      `${flag?.note ?? ''}|${fill}|${ink}|${badgeFamily}|${fontsReady}|${params.attention.badgeSize}`,
      flag?.note ?? '',
      fill,
      ink,
      badgeFamily,
      params.attention.badgeSize,
      Math.max(params.attention.badgeSize, runsTo - runsFrom),
    )
    held.plate.visible = wearsBadge
    const slot = shelf.get(id)
    if (wearsBadge && slot !== undefined && base) {
      const { w, h } = held
      held.plate.scale.set(w, h, 1)
      orient(held.plate, mesh)
      // Where the solve put it, if it ran. Otherwise the shelf: plates
      // stacked on the zone's top border, left edges flush with the zone's.
      const solved = params.attention.seek ? plateAt.current.get(id) : undefined
      let eased: { x: number; y: number } | undefined
      if (solved) {
        let m = plateMotion.current.get(id)
        if (!m) {
          // Born on its own card, so a new plate grows out of the artifact
          // rather than appearing somewhere else on the wall.
          m = { x: 0, y: 0, vx: 0, vy: 0 }
          plateMotion.current.set(id, m)
        }
        // Clamped: a tab that has been asleep hands back a delta measured
        // in seconds, and the spring would fling the plate off the wall.
        const dt = Math.min(delta, 1 / 30)
        const k = params.attention.seekStiffness
        const c = params.attention.seekDamping
        m.vx += ((solved.dx - m.x) * k - m.vx * c) * dt
        m.vy += ((solved.dy - m.y) * k - m.vy * c) * dt
        m.x += m.vx * dt
        m.y += m.vy * dt
        if (Math.abs(m.vx) + Math.abs(m.vy) + Math.abs(solved.dx - m.x) + Math.abs(solved.dy - m.y) > 1e-4)
          springing = true
        eased = m
      }
      const shelfY =
        -base.y + params.attention.floatLift + slot * (h + params.attention.floatGap) + h / 2
      const offset = (
        eased
          ? new THREE.Vector3(eased.x, eased.y, BADGE_LIFT)
          : new THREE.Vector3(
              base.x + w / 2 - mesh.position.x,
              shelfY - mesh.position.y,
              BADGE_LIFT,
            )
      ).applyEuler(held.plate.rotation)
      held.plate.position.copy(mesh.position).add(offset)
      toPlane(held.plate.position)
      const plateMat = held.plate.material as THREE.MeshBasicMaterial
      plateMat.transparent = true
      // Half strength once the question is closed: still legible, no longer asking.
      plateMat.opacity = cut * (flag?.inert ? 0.5 : 1)
      // Down to the top of the card, so the line says which artifact is
      // asking even when the plate has climbed clear of the pile. Read off
      // the mesh rather than the rect: a flagged card stands `tier.lift`
      // forward of its rank, and a line drawn to the rect's own z lands
      // behind the card it is pointing at.
      // A plate resting directly on top of its own card needs no line:
      // there is nothing for one to disambiguate. Anything that has moved
      // off the card gets one, however it got there.
      const resting = solved ? solved.welded : noLeader.has(id)
      if (!resting) {
        drawLeader({ mesh, held, w, h, drawnW, drawnH, swell, pulse, unturn, leaderPoints, level, params })
      }
    } else if (wearsBadge) {
      const { w, h } = held
      held.plate.scale.set(w, h, 1)
      orient(held.plate, mesh)
      // Measured in the plate's own frame and then turned with it, so the
      // badge stays on the top border from every angle rather than
      // sliding off it as the wall turns. Left edges flush.
      held.plate.position
        .copy(mesh.position)
        .add(
          new THREE.Vector3(
            (w - drawnW * swell) / 2,
            (drawnH * swell + h) / 2,
            BADGE_LIFT,
          ).applyEuler(held.plate.rotation),
        )
      toPlane(held.plate.position)
    }
  }
  return { wearsBadge, springing }
}
