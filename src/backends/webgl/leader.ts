import * as THREE from 'three'
import type { StackParams } from '@/params.ts'
import type { Level } from '@shared/attention.ts'
import { clamp } from '@/backends/webgl/constants.ts'

export function drawLeader({
  mesh,
  held,
  w,
  h,
  drawnW,
  drawnH,
  swell,
  pulse,
  unturn,
  leaderPoints,
  level,
  params,
}: {
  mesh: THREE.Object3D
  held: { plate: THREE.Object3D }
  w: number
  h: number
  drawnW: number
  drawnH: number
  swell: number
  pulse: number
  unturn: THREE.Quaternion
  leaderPoints: Map<Level, number[]>
  level: Level
  params: StackParams
}): void {
  // Read off the meshes rather than the rects: a flagged card stands
  // `tier.lift` forward of its rank, and a line drawn to the rect's
  // own z lands behind the card it points at.
  // Everything in the plate's own frame: the card's plane when the
  // plate lies in it, the screen when it faces the camera. Depth
  // between the two falls out onto the frame's z, so a plate pulled
  // forward to the badge plane still measures its card where it is.
  const rel = mesh.position
    .clone()
    .sub(held.plate.position)
    .applyQuaternion(unturn.copy(held.plate.quaternion).invert())
  const cx = rel.x
  const cy = rel.y
  const chw = (drawnW * swell * pulse) / 2
  const chh = (drawnH * swell * pulse) / 2
  // The line leaves the center of the edge that faces the card,
  // chosen by which axis the card lies further beyond. The solver's
  // `footOf` is the same rule in screen space.
  const sideways = Math.abs(cx) - w / 2 > Math.abs(cy) - h / 2
  const fx = sideways ? Math.sign(cx) * (w / 2) : 0
  const fy = sideways ? 0 : Math.sign(cy) * (h / 2)
  const points = leaderPoints.get(level) ?? []
  const at = (v: THREE.Vector3) =>
    points.push(
      held.plate.position.x + v.x,
      held.plate.position.y + v.y,
      held.plate.position.z + v.z,
    )
  const foot = new THREE.Vector3(fx, fy, 0).applyEuler(held.plate.rotation)
  if (params.attention.leaderElbow) {
    // Leaves the plate square to the edge the card lies beyond, runs
    // to the card's span, and turns once onto its nearest border. A
    // plate level with its card needs no turn at all.
    let ex: number
    let ey: number
    let hx: number
    let hy: number
    if (sideways) {
      ey = fy
      if (Math.abs(fy - cy) <= chh) {
        ex = hx = cx - Math.sign(cx) * chw
        hy = fy
      } else {
        ex = hx = clamp(fx, cx - chw, cx + chw)
        hy = cy - Math.sign(cy - fy) * chh
      }
    } else {
      ex = fx
      if (Math.abs(fx - cx) <= chw) {
        ey = hy = cy - Math.sign(cy) * chh
        hx = fx
      } else {
        ey = hy = clamp(fy, cy - chh, cy + chh)
        hx = cx - Math.sign(cx - fx) * chw
      }
    }
    const elbow = new THREE.Vector3(ex, ey, 0).applyEuler(held.plate.rotation)
    const head = new THREE.Vector3(hx, hy, rel.z).applyEuler(held.plate.rotation)
    const bends = Math.abs(ex - hx) + Math.abs(ey - hy) > 1e-6
    at(foot)
    if (bends) {
      at(elbow)
      at(elbow)
    }
    at(head)
  } else {
    // Between the two nearest edges: the edge of the plate that faces
    // its card, so the line never crosses the plate it comes from, and
    // the point of the card's border nearest the plate, so a plate on
    // the flank gets a short level line rather than a diagonal to the
    // top.
    // The point of the card's border nearest the foot.
    const head = new THREE.Vector3(
      cx + clamp(fx - cx, -chw, chw),
      cy + clamp(fy - cy, -chh, chh),
      rel.z,
    ).applyEuler(held.plate.rotation)
    at(foot)
    at(head)
  }
  leaderPoints.set(level, points)
}
