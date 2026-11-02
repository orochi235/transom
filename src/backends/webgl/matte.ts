import * as THREE from 'three'

/** Squares across a card's long side. They belong to the card and scale with
 *  it: squares fixed to the screen would swim across a card as it moves. */
const CELLS = 24

type Uniforms = { uMatte: { value: number }; uMatteCells: { value: THREE.Vector2 } }

const FRAGMENT = /* glsl */ `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  vec2 cell = floor( vMapUv * uMatteCells );
  // Linear values for sRGB #fff and #ccc.
  vec3 check = mix( vec3( 1.0 ), vec3( 0.604 ), mod( cell.x + cell.y, 2.0 ) );
  float under = uMatte * ( 1.0 - sampledDiffuseColor.a );
  float alpha = sampledDiffuseColor.a + under;
  vec3 rgb = ( sampledDiffuseColor.rgb * sampledDiffuseColor.a + check * under ) / max( alpha, 1e-4 );
  diffuseColor *= vec4( rgb, alpha );
#endif
`

const held = new WeakMap<THREE.MeshBasicMaterial, Uniforms>()

function uniformsOf(mat: THREE.MeshBasicMaterial): Uniforms {
  let u = held.get(mat)
  if (u) return u
  const made: Uniforms = { uMatte: { value: 0 }, uMatteCells: { value: new THREE.Vector2(CELLS, CELLS) } }
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, made)
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uMatte;\nuniform vec2 uMatteCells;\nvoid main() {')
      .replace('#include <map_fragment>', FRAGMENT)
  }
  mat.customProgramCacheKey = () => 'transom-matte'
  mat.needsUpdate = true
  held.set(mat, made)
  u = made
  return u
}

/** Puts the checkerboard behind a card's transparent pixels at `opacity`, 0
 *  for none. Opaque pixels are untouched whatever it is. */
export function setMatte(mat: THREE.MeshBasicMaterial, opacity: number, aspect: number) {
  const u = uniformsOf(mat)
  u.uMatte.value = opacity
  const long = Math.max(aspect, 1 / aspect)
  u.uMatteCells.value.set(
    aspect >= 1 ? CELLS : CELLS / long,
    aspect >= 1 ? CELLS / long : CELLS,
  )
}
