import * as THREE from "three";

/**
 * The parts of the Cortex brain that more than one scene draws: the cell
 * shader of the core, its halo, and the filaments out to the dotted shell.
 * The full brain lives in brain-scene.tsx; a small copy follows the
 * project journey (cortex-orb.tsx).
 */

export function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Core ────────────────────────────────────────────────────────────────────

export const CORE_VERTEX = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vObj = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const CORE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uPulse;
  uniform vec3 uCellA;
  uniform vec3 uCellB;
  uniform vec3 uWall;
  uniform vec3 uRim;
  varying vec3 vObj;
  varying vec3 vNormalW;
  varying vec3 vViewDir;

  vec3 hash3(vec3 p) {
    p = vec3(
      dot(p, vec3(127.1, 311.7, 74.7)),
      dot(p, vec3(269.5, 183.3, 246.1)),
      dot(p, vec3(113.5, 271.9, 124.6))
    );
    return fract(sin(p) * 43758.5453123);
  }

  // x: distance to nearest cell, y: to second nearest, z: nearest cell id.
  vec3 worley(vec3 p) {
    vec3 cell = floor(p);
    vec3 local = fract(p);
    float f1 = 8.0;
    float f2 = 8.0;
    float id = 0.0;
    for (int x = -1; x <= 1; x++) {
      for (int y = -1; y <= 1; y++) {
        for (int z = -1; z <= 1; z++) {
          vec3 g = vec3(float(x), float(y), float(z));
          vec3 h = hash3(cell + g);
          vec3 o = 0.5 + 0.38 * sin(uTime * 0.32 + 6.2831 * h);
          vec3 r = g + o - local;
          float d = dot(r, r);
          if (d < f1) {
            f2 = f1;
            f1 = d;
            id = h.x;
          } else if (d < f2) {
            f2 = d;
          }
        }
      }
    }
    return vec3(sqrt(f1), sqrt(f2), id);
  }

  void main() {
    vec3 p = normalize(vObj) * 4.4;
    vec3 w = worley(p);
    float edge = w.y - w.x;
    float wall = 1.0 - smoothstep(0.03, 0.17, edge);
    float dome = 1.0 - smoothstep(0.0, 0.75, w.x);

    vec3 cell = mix(uCellA, uCellB, w.z);
    cell *= 0.72 + 0.42 * dome;
    vec3 colour = mix(cell, uWall, wall);

    vec3 n = normalize(vNormalW);
    vec3 v = normalize(vViewDir);
    vec3 l = normalize(vec3(-0.45, 0.7, 0.6));
    float spec = pow(max(dot(reflect(-l, n), v), 0.0), 28.0) * (1.0 - wall);
    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 2.2);

    colour += spec * 0.55;
    colour = mix(colour, uRim, fresnel * 0.7);
    colour += uRim * fresnel * (0.12 + 0.4 * uPulse);
    gl_FragColor = vec4(colour, 1.0);
  }
`;

export const HALO_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const HALO_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec3 vNormal;
  void main() {
    float intensity = pow(clamp(0.74 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 3.0);
    gl_FragColor = vec4(uColor, intensity * uStrength);
  }
`;

/** Core colours, shared so the small Cortex reads as the same brain. */
export const CORE_COLORS = {
  cellA: "#8F7DF7",
  cellB: "#C8BDFF",
  wall: "#23178F",
  rim: "#F2EDFF",
  halo: "#D9D0FF",
} as const;

// ── Filaments and shell ─────────────────────────────────────────────────────

export const LINE_VERTEX = /* glsl */ `
  attribute float aT;
  varying float vT;
  void main() {
    vT = aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const LINE_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying float vT;
  void main() {
    float alpha = mix(0.3, 0.2, smoothstep(0.0, 1.0, vT)) * uOpacity;
    gl_FragColor = vec4(vec3(1.0), alpha);
  }
`;

export const DOT_VERTEX = /* glsl */ `
  uniform float uSize;
  uniform float uPixelRatio;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * uPixelRatio * (9.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

export const DOT_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.12, d) * uOpacity;
    gl_FragColor = vec4(vec3(1.0), alpha);
  }
`;

/**
 * How dense the filaments are. The defaults are the full brain; a small orb
 * wants far fewer, or it reads as a hedgehog.
 */
export interface FilamentDensity {
  /** Highest latitude band, in degrees. */
  latMax?: number;
  /** Degrees between latitude bands. */
  latStep?: number;
  /** Filaments round the equator; bands nearer the poles get fewer. */
  around?: number;
  /** Fewest filaments in any band. */
  minPerBand?: number;
  /** Chance a shell dot gets a filament back to the core. */
  lineChance?: number;
  /** Chance a shell dot gets a twin beside it. */
  twinChance?: number;
}

export function buildFilaments(coreRadius = 1, shellRadius = 3, density: FilamentDensity = {}) {
  const {
    latMax = 78,
    latStep = 12,
    around = 52,
    minPerBand = 8,
    lineChance = 0.74,
    twinChance = 0.55,
  } = density;
  const random = mulberry32(4401);
  const linePositions: number[] = [];
  const lineT: number[] = [];
  const dotPositions: number[] = [];

  const jitter = new THREE.Vector3();
  const start = new THREE.Vector3();
  const direction = new THREE.Vector3();

  for (let band = 0, latDeg = -latMax; latDeg <= latMax; band++, latDeg += latStep) {
    const lat = THREE.MathUtils.degToRad(latDeg);
    const count = Math.max(minPerBand, Math.round(around * Math.cos(lat)));
    const phase = band % 2 === 0 ? 0 : Math.PI / count;
    for (let i = 0; i < count; i++) {
      const lon = (i / count) * Math.PI * 2 + phase;
      direction.set(
        Math.sin(lon) * Math.cos(lat),
        Math.sin(lat),
        Math.cos(lon) * Math.cos(lat),
      );
      const tip = direction.clone().multiplyScalar(shellRadius);
      dotPositions.push(tip.x, tip.y, tip.z);

      // Paired dots, as on a printed dial.
      if (random() < twinChance) {
        const twin = lon + 0.03;
        dotPositions.push(
          Math.sin(twin) * Math.cos(lat) * shellRadius,
          Math.sin(lat) * shellRadius,
          Math.cos(twin) * Math.cos(lat) * shellRadius,
        );
      }

      if (random() < lineChance) {
        jitter.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).multiplyScalar(0.95);
        start.copy(direction).add(jitter).normalize().multiplyScalar(coreRadius * 0.96);
        linePositions.push(start.x, start.y, start.z, tip.x, tip.y, tip.z);
        lineT.push(0, 1);
      }
    }
  }

  const lines = new THREE.BufferGeometry();
  lines.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
  lines.setAttribute("aT", new THREE.Float32BufferAttribute(lineT, 1));

  const dots = new THREE.BufferGeometry();
  dots.setAttribute("position", new THREE.Float32BufferAttribute(dotPositions, 3));

  return { lines, dots };
}
