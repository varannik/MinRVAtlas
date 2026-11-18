"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import {
  CORE_COLORS,
  CORE_FRAGMENT,
  CORE_VERTEX,
  DOT_FRAGMENT,
  DOT_VERTEX,
  HALO_FRAGMENT,
  HALO_VERTEX,
  LINE_VERTEX,
  buildFilaments,
  type FilamentDensity,
} from "./brain-parts";

/**
 * About 40 filaments instead of the full brain's few hundred: at this size
 * the full set reads as a hedgehog of pins.
 */
const ORB_DENSITY: FilamentDensity = {
  latMax: 72,
  latStep: 24,
  around: 10,
  minPerBand: 4,
  lineChance: 0.8,
  twinChance: 0.3,
};

/** Filaments that can drop their inner part, leaving a corona at the shell. */
const ORB_LINE_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  uniform float uInner;
  varying float vT;
  void main() {
    float alpha = mix(0.3, 0.2, smoothstep(0.0, 1.0, vT)) * uOpacity;
    alpha *= smoothstep(uInner, uInner + 0.25, vT);
    gl_FragColor = vec4(vec3(1.0), alpha);
  }
`;

/** A faint violet fill for the shell, brighter at its edge. */
const VEIL_VERTEX = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const VEIL_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    float edge = 1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir)));
    float alpha = (0.012 + 0.075 * pow(edge, 3.0)) * uOpacity;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

/**
 * Cortex in miniature: the same cell-textured core, halo and filaments to a
 * dotted shell as the full brain, drawn at unit core radius. The caller
 * scales and places it. `thinking` brightens the rim and quickens the spin.
 * `cloud` opens it up: the core shrinks away and the filaments keep only
 * their outer half, so Cortex becomes a transparent cloud around whatever
 * sits inside its shell.
 */
export function CortexOrb({
  thinking = false,
  highlighted = false,
  cloud = false,
  shell = 3,
  dotSize = 2.6,
  onClick,
  onHover,
}: {
  thinking?: boolean;
  highlighted?: boolean;
  cloud?: boolean;
  /** Shell radius, in core radii. Smaller gives a core with short spikes. */
  shell?: number;
  /** Shell dot size; smaller orbs want smaller dots. */
  dotSize?: number;
  onClick?: (event: ThreeEvent<MouseEvent>) => void;
  onHover?: (over: boolean) => void;
}) {
  const spinRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const coreMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const haloMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const dotMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const lineMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const veilMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const openRef = useRef(cloud ? 1 : 0);

  const { lines, dots } = useMemo(() => buildFilaments(1, shell, ORB_DENSITY), [shell]);
  useEffect(
    () => () => {
      lines.dispose();
      dots.dispose();
    },
    [lines, dots],
  );

  const coreUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uCellA: { value: new THREE.Color(CORE_COLORS.cellA) },
      uCellB: { value: new THREE.Color(CORE_COLORS.cellB) },
      uWall: { value: new THREE.Color(CORE_COLORS.wall) },
      uRim: { value: new THREE.Color(CORE_COLORS.rim) },
    }),
    [],
  );
  const haloUniforms = useMemo(
    () => ({ uColor: { value: new THREE.Color(CORE_COLORS.halo) }, uStrength: { value: 0.35 } }),
    [],
  );
  const lineUniforms = useMemo(() => ({ uOpacity: { value: 0.9 }, uInner: { value: -0.3 } }), []);
  const veilUniforms = useMemo(
    () => ({ uColor: { value: new THREE.Color("#9C8CFF") }, uOpacity: { value: 0 } }),
    [],
  );
  const dotUniforms = useMemo(
    () => ({ uOpacity: { value: 1 }, uSize: { value: dotSize }, uPixelRatio: { value: 1 } }),
    [dotSize],
  );

  useFrame((state, delta) => {
    const d = Math.min(delta, 0.1);
    const open = (openRef.current = THREE.MathUtils.damp(openRef.current, cloud ? 1 : 0, 3, d));
    const core = coreMaterialRef.current;
    const halo = haloMaterialRef.current;
    const lit = thinking ? 1 : highlighted ? 0.6 : 0;
    if (core) {
      core.uniforms.uTime.value = state.clock.elapsedTime;
      core.uniforms.uPulse.value = THREE.MathUtils.damp(core.uniforms.uPulse.value, lit, 4, d);
    }
    if (halo && core) halo.uniforms.uStrength.value = 0.35 + core.uniforms.uPulse.value * 0.4;
    if (dotMaterialRef.current) {
      dotMaterialRef.current.uniforms.uPixelRatio.value = state.viewport.dpr;
      dotMaterialRef.current.uniforms.uOpacity.value = 1 - open * 0.35;
    }
    if (lineMaterialRef.current) {
      const u = lineMaterialRef.current.uniforms;
      u.uOpacity.value = THREE.MathUtils.damp(u.uOpacity.value, (thinking ? 1.6 : 0.9) * (1 - open * 0.5), 3, d);
      // As a cloud, only the outer part of each filament stays: a corona at the shell.
      u.uInner.value = THREE.MathUtils.lerp(-0.3, 0.64, open);
    }
    if (veilMaterialRef.current) veilMaterialRef.current.uniforms.uOpacity.value = open * (thinking ? 1.5 : 1);
    if (spinRef.current) spinRef.current.rotation.y += d * (thinking ? 0.9 : 0.18) * (1 - open * 0.6);
    const breathe = 1 + Math.sin(state.clock.elapsedTime * (thinking ? 4 : 1.1)) * (thinking ? 0.03 : 0.012);
    const shrink = Math.max(0.0001, 1 - open);
    if (coreRef.current) {
      coreRef.current.scale.setScalar(breathe * shrink);
      coreRef.current.visible = open < 0.98;
    }
    if (haloRef.current) {
      haloRef.current.scale.setScalar(1.22 * shrink);
      haloRef.current.visible = open < 0.98;
    }
  });

  return (
    <group ref={spinRef}>
      <mesh ref={coreRef} raycast={() => null}>
        <sphereGeometry args={[1, 96, 96]} />
        <shaderMaterial
          ref={coreMaterialRef}
          vertexShader={CORE_VERTEX}
          fragmentShader={CORE_FRAGMENT}
          uniforms={coreUniforms}
        />
      </mesh>
      <mesh ref={haloRef} scale={1.22} raycast={() => null}>
        <sphereGeometry args={[1, 48, 48]} />
        <shaderMaterial
          ref={haloMaterialRef}
          vertexShader={HALO_VERTEX}
          fragmentShader={HALO_FRAGMENT}
          uniforms={haloUniforms}
          side={THREE.BackSide}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <lineSegments geometry={lines} raycast={() => null}>
        <shaderMaterial
          ref={lineMaterialRef}
          vertexShader={LINE_VERTEX}
          fragmentShader={ORB_LINE_FRAGMENT}
          uniforms={lineUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
      <points geometry={dots} raycast={() => null}>
        <shaderMaterial
          ref={dotMaterialRef}
          vertexShader={DOT_VERTEX}
          fragmentShader={DOT_FRAGMENT}
          uniforms={dotUniforms}
          transparent
          depthWrite={false}
        />
      </points>
      <mesh raycast={() => null} renderOrder={-1}>
        <sphereGeometry args={[shell + 0.02, 48, 48]} />
        <shaderMaterial
          ref={veilMaterialRef}
          vertexShader={VEIL_VERTEX}
          fragmentShader={VEIL_FRAGMENT}
          uniforms={veilUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {/* A larger, invisible target so the small orb is easy to click; off
          as a cloud, so whatever sits inside can be clicked through it. */}
      {!cloud && (
        <mesh
          onClick={onClick}
          onPointerOver={(event) => {
            event.stopPropagation();
            onHover?.(true);
          }}
          onPointerOut={() => onHover?.(false)}
        >
          <sphereGeometry args={[Math.max(shell * 0.75, 1.3), 12, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
