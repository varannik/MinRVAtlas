"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * A single liquid drop around the disc Cortex is working on: one translucent
 * layer whose surface flows slowly, brighter at its rim, with one soft
 * highlight. Drawn at unit radius; the caller scales it. The disc stays
 * visible through it.
 */

const NOISE = /* glsl */ `
  // 3D simplex noise (Ashima Arts, MIT).
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
`;

const LIQUID_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uFlow;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying float vSwell;
  ${NOISE}

  // Broad, slow swells only: a liquid surface, not a crumpled one.
  float swell(vec3 p) {
    return snoise(p * 0.85 + vec3(0.0, uTime * 0.3, uTime * 0.2)) * 0.075;
  }

  void main() {
    vec3 p = position;
    float s = swell(p) * uFlow;
    vec3 moved = p + normal * s;

    // Bend the normal with the surface so the rim and highlight flow too.
    vec3 tangent = normalize(cross(normal, abs(normal.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 bitangent = cross(normal, tangent);
    float e = 0.18;
    vec3 a = p + tangent * e;
    vec3 b = p + bitangent * e;
    vec3 movedA = a + normalize(a) * swell(a) * uFlow;
    vec3 movedB = b + normalize(b) * swell(b) * uFlow;
    vec3 bent = normalize(cross(movedA - moved, movedB - moved));
    if (dot(bent, normal) < 0.0) bent = -bent;

    vec4 world = modelMatrix * vec4(moved, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * bent);
    vViewDir = normalize(cameraPosition - world.xyz);
    vSwell = s;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const LIQUID_FRAGMENT = /* glsl */ `
  uniform float uGlow;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying float vSwell;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(vViewDir);
    float facing = clamp(dot(n, v), 0.0, 1.0);
    float rim = pow(1.0 - facing, 1.8);

    // Clear serpentine body, pale at the rim, a touch lighter where it swells.
    vec3 colour = mix(vec3(0.435, 0.400, 0.247), vec3(0.851, 0.816, 0.765), rim);
    colour += vec3(0.08, 0.09, 0.03) * smoothstep(0.0, 0.08, vSwell);

    // One soft highlight, fixed to the view like a reflection.
    vec3 nv = normalize((viewMatrix * vec4(n, 0.0)).xyz);
    float shine = smoothstep(0.9, 0.985, dot(nv, normalize(vec3(-0.45, 0.55, 0.7))));
    colour += vec3(1.0) * shine * 0.7;

    float alpha = 0.08 + 0.42 * rim + shine * 0.4 + uGlow * 0.1;
    gl_FragColor = vec4(colour + vec3(0.3, 0.33, 0.12) * rim * uGlow, clamp(alpha, 0.0, 0.9));
  }
`;

export function DiscBubble({ working = false }: { working?: boolean }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const clock = useRef(0);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uFlow: { value: 1 }, uGlow: { value: 0 } }), []);

  useFrame((_, delta) => {
    const material = materialRef.current;
    if (!material) return;
    const d = Math.min(delta, 0.1);
    // Flows faster while Cortex is checking.
    clock.current += d * (working ? 2.4 : 1);
    material.uniforms.uTime.value = clock.current;
    material.uniforms.uGlow.value = THREE.MathUtils.damp(material.uniforms.uGlow.value, working ? 1 : 0, 4, d);
  });

  return (
    <mesh raycast={() => null} renderOrder={2}>
      <sphereGeometry args={[1, 96, 96]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={LIQUID_VERTEX}
        fragmentShader={LIQUID_FRAGMENT}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
