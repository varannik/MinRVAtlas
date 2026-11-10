"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * A live cloud of captured CO₂ for the root of the calculation tree: sooty
 * smoke that churns and rises inside the capture ring, lit warm from above,
 * with a faint core glow in the root's status colour.
 *
 * Drawn by ray-marching animated noise through a sphere in one full-canvas
 * shader, so it reads as volume rather than a flat sprite and needs no image
 * assets.
 */

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // Full-canvas quad; the camera is not used.
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uGlow;
  varying vec2 vUv;

  const int STEPS = 36;
  const vec3 LIGHT = vec3(-0.45, 0.78, -0.43);

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }

  float fbm(vec3 p, int octaves) {
    float value = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      if (i >= octaves) break;
      value += amp * noise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      amp *= 0.5;
    }
    return value;
  }

  // Billowing smoke: swirled about the vertical, domain-warped, rising, with a
  // lumpy outline so it reads as a plume, not a ball.
  float density(vec3 p, out float raw) {
    float t = uTime;
    float angle = t * 0.16 + length(p.xz) * 1.2;
    float c = cos(angle);
    float s = sin(angle);
    vec3 q = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
    vec3 rise = vec3(0.0, -t * 0.22, 0.0);
    vec3 warp = vec3(
      fbm(q * 1.15 + rise, 2),
      fbm(q * 1.15 + vec3(5.2, 1.3, 2.8) + rise, 2),
      fbm(q * 1.15 + vec3(2.1, 7.7, 4.4) - rise, 2)) - 0.5;
    raw = fbm(q * 1.75 + warp * 1.9 + rise * 1.3, 4);
    float edge = length(p) + (0.5 - raw) * 0.6;
    float shell = 1.0 - smoothstep(0.56, 0.9, edge);
    return smoothstep(0.36, 0.6, raw) * shell;
  }

  void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    float stepSize = 2.2 / float(STEPS);
    vec3 toLight = normalize(LIGHT);
    vec4 acc = vec4(0.0);

    for (int i = 0; i < STEPS; i++) {
      vec3 p = vec3(uv * 1.05, -1.1 + (float(i) + 0.5) * stepSize);
      if (dot(p, p) > 1.05) continue;
      float raw;
      float d = density(p, raw);
      if (d < 0.02) continue;

      // Self-shadowing: denser towards the light means this point is in shade.
      float rawLight;
      float towardLight = density(p + toLight * 0.2, rawLight);
      float light = clamp(0.24 + (d - towardLight) * 1.25 + 0.2 * p.y - 0.1 * p.z, 0.0, 1.0);

      // Sooty core, brown smog body, only the light-facing rims catch the sun.
      vec3 soot = vec3(0.055, 0.052, 0.045);
      vec3 smog = vec3(0.25, 0.22, 0.17);
      vec3 lit = vec3(0.58, 0.55, 0.47);
      vec3 colour = mix(soot, smog, smoothstep(0.0, 0.6, light));
      colour = mix(colour, lit, smoothstep(0.62, 1.0, light));
      // Status colour smoulders in the core, like heat inside the plume.
      colour += uGlow * 0.5 * exp(-dot(p, p) * 4.0) * (1.0 - light);

      float alpha = d * 0.5;
      acc.rgb += (1.0 - acc.a) * colour * alpha;
      acc.a += (1.0 - acc.a) * alpha;
      if (acc.a > 0.98) break;
    }

    gl_FragColor = acc;
  }
`;

/** Redraws at ~30 fps; the smoke moves slowly, so the GPU can rest between frames. */
function Ticker({ fps }: { fps: number }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const timer = window.setInterval(() => invalidate(), 1000 / fps);
    return () => window.clearInterval(timer);
  }, [fps, invalidate]);
  return null;
}

function Smoke({ glow, still }: { glow: string; still: boolean }) {
  const ref = useRef<THREE.ShaderMaterial>(null);
  // Colour is set by the effect below, so the uniforms are built once.
  const uniforms = useMemo(() => ({ uTime: { value: 4.0 }, uGlow: { value: new THREE.Color("#BEB290") } }), []);

  useEffect(() => {
    (ref.current?.uniforms.uGlow.value as THREE.Color | undefined)?.set(glow);
  }, [glow]);

  useFrame((state) => {
    const material = ref.current;
    if (material && !still) material.uniforms.uTime.value = 4 + state.clock.elapsedTime;
  });

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={ref}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        uniforms={uniforms}
        transparent
        premultipliedAlpha
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

export function Co2Cloud({ glow, size = 140, still = false }: { glow: string; size?: number; still?: boolean }) {
  return (
    <div style={{ width: size, height: size }} className="pointer-events-none">
      <Canvas
        dpr={1}
        frameloop="demand"
        gl={{ alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: "low-power" }}
        style={{ background: "transparent" }}
      >
        <Smoke glow={glow} still={still} />
        {still ? null : <Ticker fps={30} />}
      </Canvas>
    </div>
  );
}
