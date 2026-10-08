import * as THREE from 'three'
import { ladder, SIDES, solve, type Card, type Group, type PlateSize } from '@/nav/ladder.ts'
import { offscreen, type Box } from '@/nav/whitespace.ts'
import type { StackParams } from '@/params.ts'
import { applyPose } from '@/backends/webgl/pose.ts'
import type { Chrome } from '@/backends/webgl/useChrome.ts'
import type { WallState } from '@/backends/webgl/useWallState.ts'

/** The corners of a unit quad, for turning a plane into a screen rectangle. */
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const

export function seekPlates({
  s,
  badges,
  params,
  camera,
  shelf,
  sidebarInset,
  topInset,
}: {
  s: WallState
  badges: Chrome['badges']
  params: StackParams
  camera: THREE.Camera
  shelf: Map<string, number>
  sidebarInset: { current: number }
  topInset: { current: number }
}): void {
  const { seekCamera, move, pose, meshes, bases, cardsByZone, groupAt, plateAt, plateMotion } = s
  // Solved for the frame the camera is heading to, not the one it is
  // passing through: a spot picked mid-move is wrong the moment the move
  // lands, and the hysteresis then charges the plate for leaving it.
  seekCamera.copy(camera)
  applyPose(seekCamera, move.current?.to ?? pose.current, params.camera, window.innerWidth / window.innerHeight)
  seekCamera.updateMatrixWorld(true)
  // A plate lies in its card's plane or faces the camera; its spots are
  // measured in whichever frame it is drawn in.
  const plateFrame = (card: THREE.Object3D): THREE.Euler =>
    params.attention.billboard ? seekCamera.rotation : card.rotation
  // The ladder spaces plates along the pile in the plate's frame, so the
  // cards have to be measured in that frame too: a pile's depth step shows
  // up as a sideways step once the wall is turned and the plates are not.
  const unturn = seekCamera.quaternion.clone().invert()
  const inFrame = (card: THREE.Object3D): { x: number; y: number } =>
    params.attention.billboard ? card.position.clone().applyQuaternion(unturn) : card.position
  // The drawn size, without the pulse or the hover swell: a spot chosen
  // against a card mid-breath is a spot that moves with the breath.
  const halfOf = (mesh: THREE.Object3D): { hw: number; hh: number } => ({
    hw: ((mesh.userData.drawnW as number | undefined) ?? mesh.scale.x) / 2,
    hh: ((mesh.userData.drawnH as number | undefined) ?? mesh.scale.y) / 2,
  })
  // Chrome is not plate room: the band across the top and the sidebar,
  // when it is open, cover the canvas, and a plate under either is as
  // unreadable as one off the edge.
  const usable: Box = {
    x0: 0,
    y0: topInset.current,
    x1: 1 - sidebarInset.current,
    y1: 1,
  }
  const scratch = new THREE.Vector3()
  const boxOfPlane = (
    position: THREE.Vector3,
    rotation: THREE.Euler,
    hw: number,
    hh: number,
    dx: number,
    dy: number,
  ): Box => {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const [ox, oy] of CORNERS) {
      scratch
        .set((ox as number) * hw + dx, (oy as number) * hh + dy, 0)
        .applyEuler(rotation)
        .add(position)
        .project(seekCamera)
      const sx = (scratch.x + 1) / 2
      const sy = (1 - scratch.y) / 2
      if (sx < x0) x0 = sx
      if (sx > x1) x1 = sx
      if (sy < y0) y0 = sy
      if (sy > y1) y1 = sy
    }
    return { x0, y0, x1, y1 }
  }

  // Every card on screen is ground a plate pays to stand on. A card nobody
  // can see occupies nothing: zoomed into one pile, most of the wall is
  // out of frame, and it must not read as busy edges.
  const obstacles: Box[] = []
  for (const mesh of meshes.current.values()) {
    if (!mesh.visible) continue
    const { hw, hh } = halfOf(mesh)
    const box = boxOfPlane(mesh.position, mesh.rotation, hw, hh, 0, 0)
    if (!offscreen(box, usable)) obstacles.push(box)
  }

  const toScreen = (x: number, y: number): { x: number; y: number } => {
    scratch.set(x, y, 0).project(seekCamera)
    return { x: (scratch.x + 1) / 2, y: (1 - scratch.y) / 2 }
  }
  // Every zone's cell, so a group standing on another zone's ground pays
  // for it even when nothing is drawn there.
  const cellBoxes: { zone: string; box: Box }[] = []
  for (const [zone, cell] of bases.current) {
    const a = toScreen(cell.x, -cell.y)
    const b = toScreen(cell.x + cell.w, -(cell.y + cell.h))
    cellBoxes.push({
      zone,
      box: {
        x0: Math.min(a.x, b.x),
        y0: Math.min(a.y, b.y),
        x1: Math.max(a.x, b.x),
        y1: Math.max(a.y, b.y),
      },
    })
  }

  // One group per pile, its plates in pile order, offered every side at
  // every reach — and welded when the pile's only plate is the front card's.
  const gap = params.attention.floatGap
  const groups: Group[] = []
  const members: { zone: string; ids: string[]; offsets: Map<string, { dx: number; dy: number }[]> }[] = []
  for (const [zone, ids] of cardsByZone.current) {
    // A plate drawn for the first time this frame has no size yet, and a
    // group solved around a zero-width plate would settle somewhere wrong.
    const plated = ids.filter(
      (id) => shelf.has(id) && meshes.current.has(id) && (badges.byId.get(id)?.w ?? 0) > 0,
    )
    if (plated.length === 0) continue
    const cards: Card[] = []
    const sizes: PlateSize[] = []
    const cardBoxes: Box[] = []
    for (const id of plated) {
      const mesh = meshes.current.get(id)!
      const held = badges.byId.get(id)!
      const { hw, hh } = halfOf(mesh)
      const { x, y } = inFrame(mesh)
      cards.push({ x, y, hw, hh })
      sizes.push({ w: held.w, h: held.h })
      cardBoxes.push(boxOfPlane(mesh.position, mesh.rotation, hw, hh, 0, 0))
    }
    const project = (offsets: { dx: number; dy: number }[]) =>
      offsets.map((o, i) => {
        const mesh = meshes.current.get(plated[i]!)!
        const size = sizes[i]!
        return boxOfPlane(mesh.position, plateFrame(mesh), size.w / 2, size.h / 2, o.dx, o.dy)
      })
    const offsets = new Map<string, { dx: number; dy: number }[]>()
    const candidates: Group['candidates'][number][] = []
    if (plated.length === 1 && plated[0] === ids[0]) {
      const card = cards[0]!
      const size = sizes[0]!
      const welded = [{ dx: 0, dy: card.hh + size.h / 2 + gap }]
      offsets.set('welded:1', welded)
      candidates.push({ side: 'welded', ring: 1, boxes: project(welded) })
    }
    for (const side of SIDES) {
      for (let ring = 1; ring <= params.attention.seekReach; ring++) {
        const rungs = ladder(cards, sizes, side, ring, gap)
        offsets.set(`${side}:${ring}`, rungs)
        candidates.push({ side, ring, boxes: project(rungs) })
      }
    }
    const held = groupAt.current.get(zone)
    groups.push({ zone, cards: cardBoxes, candidates, ...(held ? { held } : {}) })
    members.push({ zone, ids: plated, offsets })
  }

  const { picks } = solve(obstacles, cellBoxes, groups, {
    cover: params.attention.seekCover,
    pull: params.attention.seekPull,
    line: params.attention.seekLineCost,
    foreign: params.attention.seekForeign,
    mismatch: params.attention.seekMismatch,
    parallel: params.attention.seekParallel,
    align: params.attention.seekAlign,
    stack: params.attention.seekStack,
    exposed: params.attention.seekExposed,
    settle: params.attention.seekSettle,
  }, usable)
  groupAt.current.clear()
  for (let g = 0; g < members.length; g++) {
    const pick = picks[g]
    const group = members[g]
    if (!pick || !group) continue
    groupAt.current.set(group.zone, pick)
    const rungs = group.offsets.get(`${pick.side}:${pick.ring}`) ?? []
    group.ids.forEach((id, i) => {
      const o = rungs[i]
      if (o) plateAt.current.set(id, { dx: o.dx, dy: o.dy, welded: pick.side === 'welded' })
    })
  }

  // A wall that runs all day sheds artifacts constantly, and neither map
  // is keyed on anything that expires on its own.
  for (const id of plateAt.current.keys()) {
    if (shelf.has(id)) continue
    plateAt.current.delete(id)
    plateMotion.current.delete(id)
  }
}
