import * as THREE from 'three'

/**
 * A zone's backdrop: flat fill, or line art ruled in world space so the
 * pattern reads at one density across the wall however the cells are sized.
 * Procedural rather than a tiled texture, so it stays crisp at any zoom and
 * costs the texture budget nothing. `uPattern` picks the case, indexed by
 * `PATTERN_INDEX` in `src/backdrops.ts`; spacing, width and angle apply to
 * every pattern the same way.
 */
export function createBackdropMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color('#64748b') },
      uOpacity: { value: 0.14 },
      uSpacing: { value: 0.014 },
      uPeriod: { value: 0.028 },
      uWidth: { value: 0.001 },
      uAngle: { value: Math.PI / 4 },
      uPattern: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xy;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uSpacing;
      uniform float uPeriod;
      uniform float uWidth;
      uniform float uAngle;
      uniform int uPattern;
      varying vec2 vWorld;

      // Cover of lines ruled every \`spacing\` along \`d\`, \`width\` wide, antialiased.
      float lines(float d, float spacing, float width) {
        float gap = abs(fract(d / spacing) - 0.5) * spacing;
        float aa = max(fwidth(d), 1e-6);
        return 1.0 - smoothstep(width * 0.5 - aa, width * 0.5 + aa, gap);
      }

      // lines() for a ruling bent so that \`d\` climbs \`stretch\` times faster
      // than distance across it, which keeps a steep stretch as wide as a flat one.
      float bentLines(float d, float stretch, float spacing, float width) {
        float gap = abs(fract(d / spacing) - 0.5) * spacing / stretch;
        float aa = max(fwidth(d) / stretch, 1e-6);
        return 1.0 - smoothstep(width * 0.5 - aa, width * 0.5 + aa, gap);
      }

      // Cover of the outline at \`radius\` of whatever \`d\` measures distance to.
      //
      // Capped at the line's own width: the curved patterns measure \`d\` from a
      // cell coordinate, which jumps at the cell seam, and an uncapped fwidth
      // there widens the smoothstep across a whole cell — the seam then shows
      // as a dotted rule cutting diagonally through the pattern.
      float ring(float d, float radius, float width) {
        float aa = clamp(fwidth(d), 1e-6, width);
        return 1.0 - smoothstep(width * 0.5 - aa, width * 0.5 + aa, abs(d - radius));
      }

      void main() {
        float c = cos(uAngle);
        float s = sin(uAngle);
        // The wall turned by the angle: u runs across the ruling, v along it.
        float u = vWorld.x * c + vWorld.y * s;
        float v = -vWorld.x * s + vWorld.y * c;
        float cover = 1.0;
        if (uPattern == 1) {
          cover = lines(u, uSpacing, uWidth);
        } else if (uPattern == 2) {
          cover = max(lines(u, uSpacing, uWidth), lines(v, uSpacing, uWidth));
        } else if (uPattern == 3) {
          // Turned a further 45 degrees, which at the default angle lands the
          // ruling back on the world axes — so this is the square grid, and
          // crosshatch above is the one that reads as diamonds.
          float a = (u + v) * 0.70710678;
          float b = (u - v) * 0.70710678;
          cover = max(lines(a, uSpacing, uWidth), lines(b, uSpacing, uWidth));
        } else if (uPattern == 4) {
          // Courses one spacing tall, bricks two long, each course shifted by
          // half a brick. The mortar is the line art.
          //
          // The half: lines() draws where fract(d / spacing) is 0.5, so the
          // courses sit at spacing * (n + 0.5) while a bare floor(v / spacing)
          // breaks at spacing * n. Indexing the row without it changes the
          // shift halfway up each visible course, which offsets every short
          // line by half a row.
          float row = floor(v / uSpacing + 0.5);
          float shift = mod(row, 2.0) * uSpacing;
          cover = max(lines(v, uSpacing, uWidth), lines(u + shift, 2.0 * uSpacing, uWidth));
        } else if (uPattern == 5) {
          // A dot at the center of every cell. Never thinner than the line
          // width, never smaller than a tenth of the cell.
          vec2 cell = (vec2(fract(u / uSpacing), fract(v / uSpacing)) - 0.5) * uSpacing;
          float r = length(cell);
          float rad = max(uWidth, uSpacing * 0.12);
          float aa = max(fwidth(r), 1e-6);
          cover = 1.0 - smoothstep(rad - aa, rad + aa, r);
        } else if (uPattern == 6) {
          cover = mod(floor(u / uSpacing) + floor(v / uSpacing), 2.0);
        } else if (uPattern == 7) {
          // Argyle: diamonds abutting in alternate tints, taller than they are
          // wide, with a thin overstitch through their centers. No outline —
          // drawing a lattice as well turns the whole thing into plaid, since
          // the diamonds are the alternation and not a grid with fill.
          //
          // Built on the pair the grid case uses, not on u/v. An argyle diamond
          // stands upright and is elongated, and a turned checkerboard
          // cannot be elongated: scaling either of its axes shears the cells
          // into slanted rectangles instead of making them taller. So the turn
          // is undone first, the diamond is formed here with its own aspect,
          // and the wall's angle still carries the result.
          float gx = (u - v) * 0.70710678;
          float gy = (u + v) * 0.70710678;
          float halfW = uSpacing;
          float halfH = uSpacing * 1.7;
          // Cell units: the lattice is the integer grid of a and b, whose
          // cells are rhombi with diagonals 2*halfW across and 2*halfH tall.
          float a = gx / halfW + gy / halfH;
          float b = gx / halfW - gy / halfH;
          float fill = mod(floor(a) + floor(b), 2.0) * 0.42;
          // lines() draws at n + 0.5, which in cell units is the middle of a
          // cell — the overstitch, without an offset of its own.
          float stitchW = (uWidth / uSpacing) * 0.9;
          float stitch = max(lines(a, 1.0, stitchW), lines(b, 1.0, stitchW));
          cover = max(fill, stitch);
        } else if (uPattern == 8) {
          // Chevron: one ruling creased into a zigzag. The two axes are set
          // apart — how far apart the rules are, and how long one zigzag runs
          // — because a chevron is read by the angle between them, and tying
          // the two to one number fixes that angle at forty-five degrees.
          float zig = abs(fract(u / uPeriod) - 0.5) * 2.0 * uSpacing;
          cover = lines(v + zig, uSpacing, uWidth);
        } else if (uPattern == 9) {
          // The same ruling bent on a sine rather than a crease, and split the
          // same way: \`uPeriod\` is one wave, \`uSpacing\` the gap between rules.
          cover = lines(
            v + sin(u / uPeriod * 6.28318531) * uSpacing * 0.5,
            uSpacing,
            uWidth
          );
        } else if (uPattern == 10) {
          // Scales: a circle per cell, alternate rows shifted half a cell, so
          // each one sits in the notch between the two above it.
          float shift = mod(floor(v / uSpacing), 2.0) * 0.5;
          vec2 cell = vec2(fract(u / uSpacing + shift) - 0.5, fract(v / uSpacing) - 0.5);
          cover = ring(length(cell) * uSpacing, uSpacing * 0.5, uWidth);
        } else if (uPattern == 11) {
          // Hexagons. Two square lattices half a cell apart interleave into the
          // honeycomb: a point belongs to whichever center it is nearer, and
          // the hexagon's own edge is where its distance reads half a spacing.
          vec2 p = vec2(u, v) / uSpacing;
          vec2 h = vec2(1.0, 1.73205081);
          vec2 a = mod(p, h) - h * 0.5;
          vec2 b = mod(p + h * 0.5, h) - h * 0.5;
          vec2 g = abs(dot(a, a) < dot(b, b) ? a : b);
          cover = ring(max(dot(g, vec2(0.5, 0.86602540)), g.x) * uSpacing, uSpacing * 0.5, uWidth);
        } else if (uPattern == 12) {
          // Three rulings sixty degrees apart, which is the isometric grid.
          float t2 = u * 0.86602540 + v * 0.5;
          float t3 = u * 0.86602540 - v * 0.5;
          cover = max(
            lines(v, uSpacing, uWidth),
            max(lines(t2, uSpacing, uWidth), lines(t3, uSpacing, uWidth))
          );
        } else if (uPattern == 13) {
          // Basketweave: tiles two spacings square, each split into a pair of
          // planks that turn a quarter on every other tile.
          //
          // The half in the tile index: lines() draws at spacing * (n + 0.5),
          // so the tile borders fall at odd multiples of the spacing while a
          // bare floor(u / 2 spacing) steps at the even ones. Index the tile
          // without it and the planks turn a tile's width away from the border
          // they are supposed to be inside, which scatters the whole weave.
          float turn = mod(
            floor(u / (2.0 * uSpacing) + 0.5) + floor(v / (2.0 * uSpacing) + 0.5),
            2.0
          );
          // Offset by a spacing so the split lands on the tile's middle.
          float split = turn < 0.5
            ? lines(v + uSpacing, 2.0 * uSpacing, uWidth)
            : lines(u + uSpacing, 2.0 * uSpacing, uWidth);
          float edge = max(lines(u, 2.0 * uSpacing, uWidth), lines(v, 2.0 * uSpacing, uWidth));
          cover = max(split, edge);
        } else if (uPattern == 14) {
          // Parquet: blocks three strips wide, the strips turning a quarter on
          // every other block. Basketweave's larger cousin — same construction,
          // same reason for the half in the block index.
          float block = 3.0 * uSpacing;
          float turn = mod(floor(u / block + 0.5) + floor(v / block + 0.5), 2.0);
          float strips = turn < 0.5 ? lines(v, uSpacing, uWidth) : lines(u, uSpacing, uWidth);
          cover = max(strips, max(lines(u, block, uWidth), lines(v, block, uWidth)));
        } else if (uPattern == 15) {
          // Dragon scale: one arc per cell, rising from the cell's two bottom
          // corners to the middle of its top edge, with alternate courses
          // shifted half a scale so each arc springs from where its two
          // neighbors below already meet.
          //
          // The circle is the one through those three points, so its center is
          // on the cell's axis at \`rise\` and its radius is what is left of the
          // course. Taking the radius as the corner-to-top distance instead —
          // which is the same three points read as a diameter — puts the whole
          // arc outside the cell, and the pattern vanishes but for its corners.
          float course = uSpacing * 0.6;
          float shift = mod(floor(v / course), 2.0) * 0.5;
          float x = (fract(u / uSpacing + shift) - 0.5) * uSpacing;
          float y = fract(v / course) * course;
          float rise = (course * course - uSpacing * uSpacing * 0.25) / (2.0 * course);
          cover = ring(length(vec2(x, y - rise)), course - rise, uWidth);
        } else if (uPattern == 16) {
          // Rosette: guilloché rings, \`uSpacing\` apart, in a medallion
          // sixteen of them across. Each ring is pushed in and out on twelve lobes
          // in proportion to its radius, and a second set runs half a lobe out
          // of phase, so the two cross into the engraved lattice. Nothing past
          // the medallion's rim: rings cut by the cell seam read as a fault.
          float cell = 16.0 * uSpacing;
          vec2 p = (vec2(fract(u / cell), fract(v / cell)) - 0.5) * cell;
          float r = length(p);
          float lobe = sin(12.0 * atan(p.y, p.x)) * r * 0.12;
          float rim = cell * 0.46;
          cover = r > rim ? 0.0 : max(lines(r + lobe, uSpacing, uWidth), lines(r - lobe, uSpacing, uWidth));
        } else if (uPattern == 17) {
          // Braid: waves' ruling three times over, a third of a wave apart and
          // swung far enough that each crosses its neighbors — the band of a
          // banknote border rather than one ripple. Measured across each
          // curve rather than up it, or the crossings fill in where it is flat.
          float k = 6.28318531 / uPeriod;
          float a = uSpacing * 0.8;
          cover = 0.0;
          for (int i = 0; i < 3; i++) {
            float t = u * k + float(i) * 2.09439510;
            float slope = a * k * cos(t);
            cover = max(cover, bentLines(v + sin(t) * a, sqrt(1.0 + slope * slope), uSpacing, uWidth));
          }
        }
        if (cover <= 0.001) discard;
        gl_FragColor = vec4(uColor, uOpacity * cover);
      }
    `,
  })
}
