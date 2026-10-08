import * as THREE from 'three'
import type { Pose } from '@/camera/frame.ts'
import { orbitOffset } from '@/camera/orbit.ts'

/**
 * Puts a camera where a pose says: orbited off the framed point by the yaw
 * and pitch, looking at it, and — under orthographic projection, where the
 * frustum is what frames — sized to the pose's half height.
 */
export function applyPose(
  cam: THREE.Camera,
  { x, y, distance, halfHeight }: Pose,
  look: { yawDeg: number; pitchDeg: number },
  aspect: number,
): void {
  const eye = orbitOffset(look.yawDeg, look.pitchDeg, distance)
  cam.position.set(x + eye.x, -y + eye.y, eye.z)
  cam.lookAt(x, -y, 0)
  if ((cam as THREE.OrthographicCamera).isOrthographicCamera) {
    const ortho = cam as THREE.OrthographicCamera
    ortho.top = halfHeight
    ortho.bottom = -halfHeight
    ortho.right = halfHeight * aspect
    ortho.left = -halfHeight * aspect
    ortho.updateProjectionMatrix()
  }
}
