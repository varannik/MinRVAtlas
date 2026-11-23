"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import * as THREE from "three";

import { stepState } from "@/lib/journey/steps";
import type { JourneyStep } from "@/lib/journey/types";
import { stepProgress, useJourney } from "@/store/journey-store";
import { DRAG_SLOP, ringReach } from "./disc-ring";
import { STATION } from "./layout";

/**
 * A closed step: a ring orbiting a solid core (see StepGyro). Opening the
 * step swaps it for the ring of discs.
 */

type GyroLook = "active" | "upcoming" | "done";

/**
 * Mineral metal drawn directly, so it reads on the light Calcite floor
 * whatever the lighting: a dark Earth body with olivine, sand and serpentine
 * film that travels round each ring and shifts with the viewing angle (the
 * MinRV palette; no hue outside it).
 */
const IRIDESCENT_VERTEX = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying vec3 vObject;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - world.xyz);
    vObject = position;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const IRIDESCENT_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform float uFade;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying vec3 vObject;

  const vec3 EARTH = vec3(0.051, 0.094, 0.008);
  const vec3 OLIVINE = vec3(0.545, 0.612, 0.267);
  const vec3 SAND = vec3(0.745, 0.698, 0.565);
  const vec3 SERPENTINE = vec3(0.435, 0.400, 0.247);
  const vec3 CALCITE = vec3(0.918, 0.855, 0.780);

  void main() {
    float facing = abs(dot(normalize(vNormalW), normalize(vViewDir)));
    float rim = pow(1.0 - facing, 1.4);
    float around = atan(vObject.y, vObject.x);

    // Thin-film colours from the palette, shifting with angle and view.
    float phase = fract(rim * 0.7 + around * 0.16 + uTime * 0.05);
    vec3 film = mix(mix(OLIVINE, SAND, smoothstep(0.0, 0.5, phase)), SERPENTINE, smoothstep(0.5, 1.0, phase));
    // Streaks of light that travel round the ring.
    float streak = smoothstep(0.35, 1.0, 0.5 + 0.5 * sin(around * 2.0 - uTime * 0.7));
    streak += 0.6 * smoothstep(0.6, 1.0, 0.5 + 0.5 * sin(around * 5.0 + uTime * 0.45));

    vec3 colour = mix(EARTH, film, (0.35 + 0.65 * streak) * (0.45 + 0.55 * facing) * uLevel);
    colour += CALCITE * pow(facing, 10.0) * 0.35;
    // Steps still to come sink toward the floor's sand.
    colour = mix(colour, SAND, uFade);
    gl_FragColor = vec4(colour, 1.0);
  }
`;

let shared: Record<GyroLook, THREE.Material> | null = null;
const filmTime = { value: 0 };

function gyroMaterials(): Record<GyroLook, THREE.Material> {
  if (shared) return shared;
  const film = (level: number, fade: number) =>
    new THREE.ShaderMaterial({
      vertexShader: IRIDESCENT_VERTEX,
      fragmentShader: IRIDESCENT_FRAGMENT,
      uniforms: { uTime: filmTime, uLevel: { value: level }, uFade: { value: fade } },
      toneMapped: false,
    });
  shared = {
    active: film(1.1, 0),
    upcoming: film(0.8, 0.42),
    // Done is Olivine, the palette's one accent.
    done: new THREE.MeshPhysicalMaterial({
      color: "#8B9C44",
      emissive: "#576627",
      emissiveIntensity: 0.35,
      metalness: 0.45,
      roughness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.2,
      toneMapped: false,
    }),
  };
  return shared;
}

/** How far the orbit ring leans back from facing the viewer (radians). */
const RING_LEAN = 0.95;

/** Core size relative to the step's reach; the "you are here" orb matches it. */
export const CORE_SIZE = 0.3;

export function coreRadius(id: JourneyStep["id"]): number {
  return ringReach(id, false) * CORE_SIZE;
}

/**
 * A step while it is closed: one thin ring orbiting a solid core. The ring
 * leans and turns slowly round the core. Mineral film while the step has
 * work left, olivine once every task in it is done. The step the project
 * is at has no core of its own: the "you are here" orb sits there.
 */
export function StepGyro({ step, reduced }: { step: JourneyStep; reduced: boolean }) {
  const current = useJourney((state) => state.current);
  const tasks = useJourney((state) => state.tasks);
  const selected = useJourney((state) => state.selectedStep === step.id);
  const hovered = useJourney((state) => state.hoveredStep === step.id);
  const selectStep = useJourney((state) => state.selectStep);
  const hoverStep = useJourney((state) => state.hoverStep);

  const complete = stepProgress(step, tasks).complete;
  const state = stepState(step.id, current);
  const look: GyroLook = complete ? "done" : state === "upcoming" ? "upcoming" : "active";
  const material = gyroMaterials()[look];
  const reach = ringReach(step.id, false);

  const { ring, core } = useMemo(
    () => ({
      ring: new THREE.TorusGeometry(reach, 0.028, 16, 180),
      core: new THREE.SphereGeometry(reach * CORE_SIZE, 48, 48),
    }),
    [reach],
  );
  useEffect(
    () => () => {
      ring.dispose();
      core.dispose();
    },
    [ring, core],
  );

  const rootRef = useRef<THREE.Group>(null);
  const spinRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  // Each step starts at its own point in the motion, so they don't turn in lockstep.
  const seed = useMemo(() => step.id.length * 1.7 + step.tasks.length * 0.9, [step.id, step.tasks.length]);

  useFrame((frame, delta) => {
    const root = rootRef.current;
    if (!root) return;
    const d = Math.min(delta, 0.1);
    // One clock for every ring's film (all rings share the material).
    filmTime.value = frame.clock.elapsedTime;
    const goal = selected ? 0.001 : hovered ? 1.08 : 1;
    root.scale.setScalar(THREE.MathUtils.damp(root.scale.x, goal, 7, d));
    root.visible = root.scale.x > 0.02;
    if (reduced) return;

    const t = frame.clock.elapsedTime + seed;
    const pace = hovered ? 2.2 : state === "current" ? 1.4 : 1;
    // The ring keeps a steady lean and swings round the core in the screen
    // plane, like an orbit: it never turns edge-on.
    if (spinRef.current) spinRef.current.rotation.z += d * 0.45 * pace;
    if (ringRef.current) ringRef.current.rotation.x = RING_LEAN + Math.sin(t * 0.35) * 0.12;
  });

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.delta > DRAG_SLOP) return;
    selectStep(step.id);
  };

  return (
    <group position={STATION[step.id]}>
      <group ref={rootRef}>
        <Billboard>
          {state !== "current" && <mesh geometry={core} material={material} raycast={() => null} />}
          <group ref={spinRef} rotation={[0, 0, seed]}>
            <mesh ref={ringRef} geometry={ring} material={material} raycast={() => null} rotation={[RING_LEAN, 0, 0]} />
          </group>
          {!selected && (
            <mesh
              onClick={onClick}
              onPointerOver={(event) => {
                event.stopPropagation();
                hoverStep(step.id);
              }}
              onPointerOut={() => hoverStep(null)}
            >
              <circleGeometry args={[reach + 0.08, 40]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          )}
        </Billboard>
      </group>
    </group>
  );
}
