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
 * Iridescent metal drawn directly, so it reads on the dark background
 * whatever the lighting: deep blue with blue, teal and orange film streaks
 * that travel round each ring and shift with the viewing angle.
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
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying vec3 vObject;
  void main() {
    float facing = abs(dot(normalize(vNormalW), normalize(vViewDir)));
    float rim = pow(1.0 - facing, 1.4);
    float around = atan(vObject.y, vObject.x);

    // Thin-film colours: shift with angle around the ring and with the view.
    vec3 film = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + rim * 0.7 + around * 0.16 + uTime * 0.05));
    // Streaks of light that travel round the ring.
    float streak = smoothstep(0.35, 1.0, 0.5 + 0.5 * sin(around * 2.0 - uTime * 0.7));
    streak += 0.6 * smoothstep(0.6, 1.0, 0.5 + 0.5 * sin(around * 5.0 + uTime * 0.45));

    vec3 base = vec3(0.12, 0.16, 0.42);
    vec3 colour = base + film * (0.35 + 0.95 * streak) * (0.45 + 0.55 * facing);
    colour += vec3(0.6, 0.78, 1.0) * pow(facing, 10.0) * 0.45;
    gl_FragColor = vec4(colour * uLevel, 1.0);
  }
`;

let shared: Record<GyroLook, THREE.Material> | null = null;
const filmTime = { value: 0 };

function gyroMaterials(): Record<GyroLook, THREE.Material> {
  if (shared) return shared;
  const film = (level: number) =>
    new THREE.ShaderMaterial({
      vertexShader: IRIDESCENT_VERTEX,
      fragmentShader: IRIDESCENT_FRAGMENT,
      uniforms: { uTime: filmTime, uLevel: { value: level } },
      toneMapped: false,
    });
  shared = {
    active: film(1.15),
    upcoming: film(0.8),
    done: new THREE.MeshPhysicalMaterial({
      color: "#FFE9B8",
      emissive: "#F5C766",
      emissiveIntensity: 0.7,
      metalness: 0.55,
      roughness: 0.28,
      clearcoat: 1,
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
 * leans and turns slowly round the core. Iridescent metal while the step has
 * work left, warm gold once every task in it is done. The step the project
 * is at has no core of its own: the orange "you are here" orb sits there.
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
