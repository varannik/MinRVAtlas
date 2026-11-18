"use client";

import { useEffect, useMemo, useRef, useState, type ComponentRef, type MutableRefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Billboard, Environment, Html, Lightformer, Line } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import { Check, CircleDashed } from "lucide-react";

import { CortexOrb } from "@/components/cortex/cortex-orb";
import { CAPABILITIES, CAPABILITY_BY_ID, LOBE_BY_ID } from "@/lib/cortex/capabilities";
import { featureContent } from "@/lib/journey/feature-content";
import { cortexHref, featuresFor } from "@/lib/journey/features";
import { PHASE, STEP_ORDER, planOf, stepState } from "@/lib/journey/steps";
import type { StepId } from "@/lib/journey/types";
import { useCortex } from "@/store/cortex-store";
import { stepProgress, usePlan, useJourney } from "@/store/journey-store";
import { DiscBubble } from "./disc-bubble";
import { StepGyro, coreRadius } from "./step-gyro";
import { DRAG_SLOP, DiscRing, discMaterials, discReach, discRegistry, ringReach } from "./disc-ring";
import {
  CREDITING_LABEL,
  LOOP_CURVE,
  LOOP_U,
  OVERVIEW_TARGET,
  STATION,
  VALIDATION_CAPTION,
  VALIDATION_CURVE,
  VALIDATION_U,
  VERIFICATION_CAPTION,
} from "./layout";

type ViewControl = {
  azimuth: number;
  polar: number;
  zoom: number;
  dragging: boolean;
  moved: number;
};

const BASE_POLAR = 0.92;
/** Height of a step's label above (or below) its ring: far out in the overview, keeping the path clear. */
function labelLift(selected: boolean, id?: StepId): number {
  if (selected) return 1.3;
  // The hub's label sits between the far side's labels, so it rises less.
  if (id === "listed") return 2.1;
  // Labels under the line drop less: the ground falls away from the camera.
  return id && LABEL_BELOW.has(id) && id !== "issued" ? 1.6 : 2.5;
}
/** Gap between the end of a label's leader and the label's centre. */
const LEADER_GAP = 0.3;
/** In the overview Cortex waits this far to the left of the step it helps with. */
const ORB_LIFT = 1.0;
const ORB_SCALE = 0.22;

/**
 * Steps whose label sits under the ring: every other step on the line, so
 * neighbouring labels never meet, and the front of the loop, clear of the hub.
 */
const LABEL_BELOW = new Set<StepId>(["methodology", "package", "issued"]);

// ── Backdrop and ground ─────────────────────────────────────────────────────

function Backdrop() {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const radial = ctx.createRadialGradient(512, 430, 40, 512, 512, 760);
    // Near-black navy, so the indigo discs and paths stand out against it.
    radial.addColorStop(0, "#16152F");
    radial.addColorStop(0.5, "#0C0B1F");
    radial.addColorStop(1, "#04040D");
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, 1024, 1024);
    const gradient = new THREE.CanvasTexture(canvas);
    gradient.colorSpace = THREE.SRGBColorSpace;
    return gradient;
  }, []);
  useEffect(() => () => texture?.dispose(), [texture]);
  if (!texture) return <color attach="background" args={["#0A0919"]} />;
  return <primitive attach="background" object={texture} />;
}

const GROUND_VERTEX = /* glsl */ `
  uniform float uPixelRatio;
  uniform vec2 uCentre;
  varying float vFade;
  void main() {
    vFade = 1.0 - smoothstep(10.0, 19.0, length(position.xz - uCentre));
    gl_PointSize = 2.2 * uPixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GROUND_FRAGMENT = /* glsl */ `
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.1, d) * 0.22 * vFade;
    gl_FragColor = vec4(0.56, 0.53, 0.98, alpha);
  }
`;

function GroundDots() {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    for (let x = OVERVIEW_TARGET.x - 18; x <= OVERVIEW_TARGET.x + 18; x += 0.6) {
      for (let z = -9; z <= 9; z += 0.6) positions.push(x, -0.02, z);
    }
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return buffer;
  }, []);
  const uniforms = useMemo(
    () => ({ uPixelRatio: { value: 1 }, uCentre: { value: new THREE.Vector2(OVERVIEW_TARGET.x, OVERVIEW_TARGET.z) } }),
    [],
  );
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame((state) => {
    if (materialRef.current) materialRef.current.uniforms.uPixelRatio.value = state.viewport.dpr;
  });
  return (
    <points geometry={geometry} raycast={() => null}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={GROUND_VERTEX}
        fragmentShader={GROUND_FRAGMENT}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </points>
  );
}

// ── Paths ───────────────────────────────────────────────────────────────────

const PATH_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const PATH_FRAGMENT = /* glsl */ `
  uniform float uProgress;
  uniform float uTime;
  uniform float uLength;
  uniform float uVisited;
  uniform vec3 uLit;
  uniform vec3 uDim;
  varying vec2 vUv;
  void main() {
    float t = vUv.x;
    float lit = 1.0 - smoothstep(uProgress - 0.002, uProgress + 0.002, t);
    float s = t * uLength;
    float wave = fract(s * 0.22 - uTime * 0.4);
    float pulse = smoothstep(0.0, 0.08, wave) * (1.0 - smoothstep(0.08, 0.4, wave));
    float dash = step(0.42, fract(s * 2.4));
    vec3 litColour = uLit * (0.95 + pulse * 0.7);
    vec3 dimColour = mix(uDim, uLit * 0.5, uVisited);
    vec3 colour = mix(dimColour, litColour, lit);
    float dimAlpha = mix(0.6 * (0.25 + 0.75 * dash), 0.55, uVisited);
    gl_FragColor = vec4(colour, mix(dimAlpha, 0.95, lit));
  }
`;

function PathTube({
  curve,
  closed,
  progress,
  visited = 0,
}: {
  curve: THREE.Curve<THREE.Vector3>;
  closed: boolean;
  progress: number;
  visited?: number;
}) {
  const geometry = useMemo(() => new THREE.TubeGeometry(curve, closed ? 240 : 360, 0.03, 8, closed), [curve, closed]);
  const uniforms = useMemo(
    () => ({
      uProgress: { value: progress },
      uTime: { value: 0 },
      uLength: { value: curve.getLength() },
      uVisited: { value: visited },
      uLit: { value: new THREE.Color("#FFE6B0") },
      uDim: { value: new THREE.Color("#8385F2") },
    }),
    // Progress animates in useFrame; the first value only seeds it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [curve],
  );
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame((state, delta) => {
    const material = materialRef.current;
    if (!material) return;
    const d = Math.min(delta, 0.1);
    const u = material.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uProgress.value = THREE.MathUtils.damp(u.uProgress.value, progress, 2.2, d);
    u.uVisited.value = THREE.MathUtils.damp(u.uVisited.value, visited, 2, d);
  });
  return (
    <mesh geometry={geometry} raycast={() => null}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={PATH_VERTEX}
        fragmentShader={PATH_FRAGMENT}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

function Paths() {
  const current = useJourney((state) => state.current);
  const laps = useJourney((state) => state.laps);
  const inLoop = PHASE[current] === "verification";
  const validation = inLoop ? 1 : (VALIDATION_U[current] ?? 0);
  const loop = inLoop ? (LOOP_U[current] ?? 0) : 0;
  const hub = STATION.listed;
  const monitor = STATION.monitor;

  return (
    <>
      <PathTube curve={VALIDATION_CURVE} closed={false} progress={validation} />
      <PathTube curve={LOOP_CURVE} closed progress={loop} visited={laps > 0 ? 1 : 0} />
      <Line
        points={[
          [hub.x, hub.y, hub.z],
          [monitor.x, 0.02, monitor.z],
        ]}
        color={inLoop ? "#FFE6B0" : "#6D6CE0"}
        lineWidth={1}
        dashed
        dashSize={0.1}
        gapSize={0.09}
        transparent
        opacity={0.5}
        toneMapped={false}
      />
    </>
  );
}

// ── You are here ────────────────────────────────────────────────────────────

/** The "you are here" orb is the current step's core, so it takes the core's size. */
const MARKER_RADIUS = 0.13;

/** Radius of the marker inside an open ring: a small light dot, so the discs stay in front. */
const MARKER_OPEN_RADIUS = 0.055;

function Marker({ reduced }: { reduced: boolean }) {
  const current = useJourney((state) => state.current);
  // With the step open, the discs matter: the marker shrinks to a faint dot.
  const open = useJourney((state) => state.selectedStep === state.current);
  const groupRef = useRef<THREE.Group>(null);
  const sizeRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const flight = useRef({ from: STATION[current].clone(), to: STATION[current].clone(), t: 1 });

  useEffect(() => {
    const group = groupRef.current;
    const to = STATION[current].clone();
    const from = group ? group.position.clone() : to.clone();
    from.y = Math.min(from.y, to.y + 2);
    const still = reduced || from.distanceTo(to) < 0.05;
    flight.current = { from, to, t: still ? 1 : 0 };
  }, [current, reduced]);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const d = Math.min(delta, 0.1);
    const f = flight.current;
    f.t = Math.min(1, f.t + d / 1.4);
    const ease = 1 - Math.pow(1 - f.t, 3);
    group.position.lerpVectors(f.from, f.to, ease);
    group.position.y += Math.sin(Math.PI * ease) * 1.1;
    const size = sizeRef.current;
    const goal = (open ? MARKER_OPEN_RADIUS : coreRadius(current)) / MARKER_RADIUS;
    if (size) size.scale.setScalar(THREE.MathUtils.damp(size.scale.x, goal, 5, d));

    const glow = glowRef.current;
    if (glow) {
      const material = glow.material as THREE.MeshBasicMaterial;
      material.opacity = THREE.MathUtils.damp(material.opacity, open ? 0.04 : 0.1, 5, d);
    }
    // A slow, faint ripple: enough to find the step, not enough to pull the eye.
    const halo = haloRef.current;
    if (halo) {
      const phase = reduced ? 0.5 : (state.clock.elapsedTime * 0.45) % 1;
      halo.scale.setScalar(1 + phase * 0.7);
      (halo.material as THREE.MeshBasicMaterial).opacity = (open ? 0.12 : 0.28) * (1 - phase);
    }
  });

  return (
    <group ref={groupRef} position={STATION[current]}>
      <group ref={sizeRef} scale={coreRadius(current) / MARKER_RADIUS}>
        <mesh raycast={() => null}>
          <sphereGeometry args={[MARKER_RADIUS, 32, 32]} />
          <meshBasicMaterial color="#FFCBA4" toneMapped={false} />
        </mesh>
        <mesh ref={glowRef} raycast={() => null} scale={1.35}>
          <sphereGeometry args={[MARKER_RADIUS, 24, 24]} />
          <meshBasicMaterial color="#FFB27A" transparent opacity={0.1} depthWrite={false} toneMapped={false} />
        </mesh>
        <Billboard>
          <mesh ref={haloRef} raycast={() => null}>
            <ringGeometry args={[0.15, 0.158, 48]} />
            <meshBasicMaterial color="#FFCBA4" transparent opacity={0.25} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
        </Billboard>
      </group>
    </group>
  );
}

// ── Cortex, following the step in focus ────────────────────────────────────

/** The orb's shell sits at 3 in its own units. */
const SHELL = 1.7;
/** Cortex is a little larger beside an open step, so its pins can be read. */
const ORB_FOCUS_SCALE = 0.34;

/** Where Cortex is this frame, and its shell radius: the link starts there. */
const orbNow = { position: new THREE.Vector3(), radius: ORB_SCALE * SHELL };

/** In the overview Cortex waits to the left of the step, level with it, clear of its label above. */
function orbPosition(id: StepId, selected: boolean, out: THREE.Vector3): THREE.Vector3 {
  const station = STATION[id];
  const reach = ringReach(id, selected);
  return out.set(station.x - reach - ORB_LIFT, station.y + reach * 0.2, station.z - 0.1);
}

/** Clear space between the top of an open ring (with its chosen disc's drop) and Cortex's shell. */
const ORB_GAP = 0.7;

/** Straight up the screen for a camera at this angle (the camera's own up vector). */
function viewUp(polar: number, azimuth: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(-Math.cos(polar) * Math.sin(azimuth), Math.sin(polar), -Math.cos(polar) * Math.cos(azimuth)).normalize();
}

/**
 * Above an open step: straight up the screen from the centre of its ring.
 * The chosen disc turns to the top of the ring, so the link runs short and
 * straight down to it.
 */
function focusOrbPosition(id: StepId, up: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(STATION[id]).addScaledVector(up, ringReach(id, true) + ORB_GAP + ORB_FOCUS_SCALE * SHELL);
}

/** The task Cortex is working on: the open task, or the next one it will ask about. */
function useCortexTask(): string | null {
  return useJourney((state) => {
    if (!state.selectedStep) return null;
    const task = state.selectedTask ? planOf(state.tasks).taskById[state.selectedTask] : null;
    // Tasks you fill in yourself don't involve Cortex.
    return task && task.step === state.selectedStep && task.cortex.role !== "none" ? task.id : null;
  });
}

/**
 * Cortex hovers over the step the project is at. When a step is opened it
 * moves beside that ring and shows pins for the capabilities it is using.
 */
function CortexFollower({ reduced }: { reduced: boolean }) {
  const current = useJourney((state) => state.current);
  const selectedStep = useJourney((state) => state.selectedStep);
  const thinking = useJourney((state) => Object.values(state.tasks).some((task) => task.status === "checking"));
  const selectStep = useJourney((state) => state.selectStep);
  const hoverStep = useJourney((state) => state.hoverStep);
  const taskId = useCortexTask();
  const focused = selectedStep !== null;
  const focus = selectedStep ?? current;

  const groupRef = useRef<THREE.Group>(null);
  const scaleRef = useRef<THREE.Group>(null);
  const baseY = useRef<number | null>(null);
  const start = useMemo(() => orbPosition(focus, false, new THREE.Vector3()), [focus]);
  const target = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const d = Math.min(delta, 0.1);
    if (focused) {
      up.setFromMatrixColumn(state.camera.matrixWorld, 1).normalize();
      focusOrbPosition(focus, up, target);
    } else {
      orbPosition(focus, false, target);
    }
    baseY.current ??= group.position.y;
    group.position.x = THREE.MathUtils.damp(group.position.x, target.x, 2.4, d);
    group.position.z = THREE.MathUtils.damp(group.position.z, target.z, 2.4, d);
    baseY.current = THREE.MathUtils.damp(baseY.current, target.y, 2.4, d);
    // Cortex holds still beside an open step, so its pin labels are easy to click.
    const bob = reduced || focused ? 0 : Math.sin(state.clock.elapsedTime * 1.3) * 0.05;
    group.position.y = baseY.current + bob;

    const scale = scaleRef.current;
    if (scale) {
      scale.scale.setScalar(THREE.MathUtils.damp(scale.scale.x, focused ? ORB_FOCUS_SCALE : ORB_SCALE, 2.6, d));
      orbNow.radius = scale.scale.x * SHELL;
    }
    orbNow.position.copy(group.position);
  });

  const plan = usePlan();
  const task = focused && taskId ? plan.taskById[taskId] : null;
  const working = useJourney((state) => (taskId ? state.tasks[taskId]?.status === "checking" : false));

  return (
    <group ref={groupRef} position={start}>
      <group ref={scaleRef} scale={ORB_SCALE}>
        <CortexOrb
          thinking={thinking}
          shell={SHELL}
          dotSize={2}
          onClick={(event) => {
            event.stopPropagation();
            if (event.delta > DRAG_SLOP) return;
            selectStep(current);
          }}
          onHover={(over) => hoverStep(over ? current : null)}
        />
      </group>
      {task ? <OrbPins taskId={task.id} working={working} /> : null}
    </group>
  );
}

// ── Feature pins on Cortex ──────────────────────────────────────────────────

/**
 * Where the lit pins sit (degrees, 0 = right): up and to the left, away from
 * the ring below and the link that drops to it. Their labels hang to the left.
 */
const PIN_ANGLES: Record<number, number[]> = {
  1: [170],
  2: [150, 190],
  3: [135, 165, 195],
  4: [122, 148, 174, 200],
};

/**
 * Pin labels stack in a column this far apart on screen (px), whatever the
 * zoom, so they never overlap; a thin leader runs from each pin to its label.
 */
const PIN_LABEL_SPACING = 66;
/** Gap between the leftmost pin tip and the label column, in world units. */
const PIN_LEAD = 0.3;

/** How many pins the open task shows, so the camera can leave room for their labels. */
function openPinCount(): number {
  const state = useJourney.getState();
  const task = state.selectedTask ? planOf(state.tasks).taskById[state.selectedTask] : undefined;
  return task && task.cortex.role !== "none" ? Math.min(task.cortex.uses.length, 4) : 0;
}

/** A pulsing halo on the tip of a pin in use. */
function PinTip({ colour, working }: { colour: string; working: boolean }) {
  const haloRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const halo = haloRef.current;
    if (!halo) return;
    const phase = (state.clock.elapsedTime * (working ? 1.6 : 0.9)) % 1;
    halo.scale.setScalar(1 + phase * 1.4);
    (halo.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - phase);
  });
  return (
    <>
      <mesh raycast={() => null}>
        <sphereGeometry args={[0.045, 20, 20]} />
        <meshBasicMaterial color={colour} toneMapped={false} />
      </mesh>
      <mesh ref={haloRef} raycast={() => null}>
        <ringGeometry args={[0.06, 0.075, 40]} />
        <meshBasicMaterial color={colour} transparent opacity={0.7} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
    </>
  );
}

/**
 * Every Cortex capability round the orb. Those the open task does not use
 * are faint dots on the shell; those it uses are bright pins in their lobe
 * colour, with a pulsing tip and their name.
 */
function OrbPins({ taskId, working }: { taskId: string; working: boolean }) {
  const scenarioId = useJourney((state) => state.scenarioId);
  const tasks = useJourney((state) => state.tasks);
  const staged = useCortex((state) => state.staged);
  const plan = usePlan();
  const task = plan.taskById[taskId];
  const used = task ? featuresFor(task).slice(0, 4) : [];
  const usedAngles = PIN_ANGLES[used.length] ?? PIN_ANGLES[4];
  const idle = CAPABILITIES.filter((capability) => !used.some((use) => use.id === capability.id));
  const shell = ORB_FOCUS_SCALE * SHELL;
  // Faint dots share the rest of the circle, leaving the lit side to the pins in use.
  const idleFrom = 218;
  const idleTo = 462;
  const idleStep = (idleTo - idleFrom) / Math.max(idle.length - 1, 1);
  const outer = shell * 1.42;
  const tips = usedAngles.slice(0, used.length).map((degrees) => {
    const angle = THREE.MathUtils.degToRad(degrees);
    return [Math.cos(angle) * outer, Math.sin(angle) * outer] as const;
  });

  const labelRefs = useRef<(THREE.Group | null)[]>([]);
  const leaderRefs = useRef<(ComponentRef<typeof Line> | null)[]>([]);

  // Keep the labels a fixed number of pixels apart: convert the spacing to
  // world units at Cortex's distance from the camera, every frame.
  useFrame((state) => {
    const count = tips.length;
    if (count === 0) return;
    const camera = state.camera as THREE.PerspectiveCamera;
    const distance = Math.max(camera.position.distanceTo(orbNow.position), 0.1);
    const pxPerUnit = state.size.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * distance);
    const step = PIN_LABEL_SPACING / pxPerUnit;
    const centreY = tips.reduce((sum, [, y]) => sum + y, 0) / count;
    const left = Math.min(...tips.map(([x]) => x)) - PIN_LEAD;
    tips.forEach(([x, y], index) => {
      const labelY = centreY + ((count - 1) / 2 - index) * step;
      labelRefs.current[index]?.position.set(left, labelY, 0.02);
      leaderRefs.current[index]?.geometry.setPositions([x, y, 0.02, left, labelY, 0.02]);
    });
  });

  return (
    <Billboard>
      {idle.map((capability, index) => {
        const angle = THREE.MathUtils.degToRad(idleFrom + index * idleStep);
        return (
          <mesh
            key={capability.id}
            position={[Math.cos(angle) * shell * 1.05, Math.sin(angle) * shell * 1.05, 0.02]}
            raycast={() => null}
          >
            <sphereGeometry args={[0.018, 10, 10]} />
            <meshBasicMaterial color={LOBE_BY_ID[capability.lobe].glow} transparent opacity={0.3} toneMapped={false} />
          </mesh>
        );
      })}
      {used.map((use, index) => {
        const capability = CAPABILITY_BY_ID[use.id];
        const lobe = LOBE_BY_ID[capability.lobe];
        const angle = THREE.MathUtils.degToRad(usedAngles[index]);
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        // Whether the feature has anything to work with yet (rules, documents, data…).
        const content = task ? featureContent(use.id, { staged, tasks, plan, task }) : null;
        const ready = (content?.count ?? 0) > 0;
        return (
          <group key={`${taskId}:${use.id}`}>
            <Line
              points={[
                [dx * shell * 0.95, dy * shell * 0.95, 0.02],
                [dx * outer, dy * outer, 0.02],
              ]}
              color={lobe.glow}
              lineWidth={working ? 3.6 : 3}
              toneMapped={false}
            />
            <group position={[dx * outer, dy * outer, 0.02]}>
              <PinTip colour={lobe.glow} working={working} />
            </group>
            {/* A thin leader from the pin to its label in the column. */}
            <Line
              ref={(node) => {
                leaderRefs.current[index] = node;
              }}
              points={[
                [dx * outer, dy * outer, 0.02],
                [dx * outer - PIN_LEAD, dy * outer, 0.02],
              ]}
              color={lobe.glow}
              lineWidth={1}
              transparent
              opacity={0.6}
              toneMapped={false}
              frustumCulled={false}
            />
            <group
              ref={(node) => {
                labelRefs.current[index] = node;
              }}
              position={[dx * outer - PIN_LEAD, dy * outer, 0.02]}
            >
              <Html zIndexRange={[28, 0]} style={{ pointerEvents: "none" }}>
                <div className="-translate-x-full -translate-y-1/2 pr-1">
                  {/* A plain link: this label renders outside the app router. */}
                  <a
                    href={cortexHref(use.id, scenarioId)}
                    data-journey-label
                    onPointerDown={(event) => event.stopPropagation()}
                    title={`${content?.sources.join(" · ") ?? ""}\nOpen ${capability.name} in Cortex${ready ? "" : " to add some"}`}
                    className={`pointer-events-auto flex flex-row-reverse items-center gap-2 whitespace-nowrap rounded-xl border-2 bg-[#120F33]/85 py-1.5 pr-2.5 pl-3 text-right text-white shadow-lg backdrop-blur-md transition-[filter,transform] hover:-translate-x-0.5 hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                      ready ? "" : "border-dashed"
                    }`}
                    style={{ borderColor: ready ? lobe.glow : `${lobe.glow}99`, boxShadow: ready ? `0 0 18px ${lobe.glow}55` : "none" }}
                  >
                    <span
                      className={`size-2 shrink-0 rounded-full ${working ? "animate-pulse" : ""}`}
                      style={{ background: lobe.glow, boxShadow: `0 0 8px ${lobe.glow}` }}
                    />
                    <span className="grid leading-tight">
                      <span className="text-[12px] font-semibold" style={{ color: lobe.glow }}>
                        {capability.name}
                      </span>
                      <span className="text-[10.5px] text-white/80">{use.doing}</span>
                      {content ? (
                        <span
                          className={`mt-0.5 inline-flex items-center justify-end gap-1 text-[10.5px] font-semibold ${
                            ready ? "text-[#B9F2C9]" : "text-[#FFC48F]"
                          }`}
                        >
                          {ready ? <Check className="size-3" strokeWidth={3} /> : <CircleDashed className="size-3" />}
                          {ready ? content.label : `${content.label} · add in Cortex`}
                        </span>
                      ) : null}
                    </span>
                  </a>
                </div>
              </Html>
            </group>
          </group>
        );
      })}
    </Billboard>
  );
}

// ── The link from Cortex to the disc it is working on ──────────────────────

/**
 * One line from Cortex to the disc of the task it is on, with a pulse
 * running along it, and a liquid drop around that disc.
 */
function CortexLink({ reduced }: { reduced: boolean }) {
  const taskId = useCortexTask();
  const current = useJourney((state) => state.current);
  // An open step whose chosen task you fill in yourself: Cortex stays out of it.
  const idle = useJourney((state) => state.selectedStep !== null) && !taskId;
  const working = useJourney((state) => (taskId ? state.tasks[taskId]?.status === "checking" : false));
  const task = usePlan().taskById[taskId ?? ""] ?? null;
  // One liquid drop, just a little bigger than the disc it holds.
  const cloudSize = task ? discReach(task.step, true) * 1.22 + 0.02 : 0.3;

  const lineRef = useRef<ComponentRef<typeof Line>>(null);
  const pulseRef = useRef<THREE.Mesh>(null);
  const cloudRef = useRef<THREE.Group>(null);
  const rootRef = useRef<THREE.Group>(null);
  const end = useMemo(() => new THREE.Vector3(), []);
  const from = useMemo(() => new THREE.Vector3(), []);
  const to = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const placed = useRef(false);

  useFrame((state, delta) => {
    const root = rootRef.current;
    if (!root) return;
    root.visible = !idle;
    if (idle) {
      placed.current = false;
      return;
    }
    const d = Math.min(delta, 0.1);
    // With a step open, Cortex points at the open task's disc, held in a drop.
    // Otherwise it points at the gyroscope of the step the project is at.
    const disc = taskId ? discRegistry.get(taskId) : undefined;
    const cloud = cloudRef.current;
    let stop: number;
    if (disc) {
      disc.getWorldPosition(end);
      stop = cloudSize;
      if (cloud) {
        if (!placed.current) cloud.position.copy(end);
        else cloud.position.lerp(end, 1 - Math.exp(-10 * d));
        cloud.scale.setScalar(THREE.MathUtils.damp(cloud.scale.x, cloudSize, 6, d));
        cloud.visible = true;
      }
      placed.current = true;
    } else {
      end.copy(STATION[current]);
      stop = ringReach(current, false) * 1.04;
      if (cloud) cloud.visible = false;
      placed.current = false;
    }

    // The line runs between the edge of Cortex and the edge of its target.
    direction.subVectors(end, orbNow.position);
    const length = direction.length();
    direction.normalize();
    from.copy(orbNow.position).addScaledVector(direction, Math.min(orbNow.radius * 0.95, length * 0.4));
    to.copy(end).addScaledVector(direction, -Math.min(stop, length * 0.45));
    lineRef.current?.geometry.setPositions([from.x, from.y, from.z, to.x, to.y, to.z]);

    const pulse = pulseRef.current;
    if (pulse) {
      const speed = working ? 1.4 : 0.55;
      const t = reduced ? 0.5 : (state.clock.elapsedTime * speed) % 1;
      pulse.position.lerpVectors(from, to, t);
      pulse.scale.setScalar(0.7 + Math.sin(Math.PI * t) * 0.6);
    }
  });

  return (
    <group ref={rootRef}>
      <Line
        ref={lineRef}
        points={[
          [0, 0, 0],
          [0, 0.01, 0],
        ]}
        color={working ? "#FFFFFF" : "#CFC5FF"}
        lineWidth={working ? 2.4 : 1.6}
        transparent
        opacity={0.9}
        toneMapped={false}
        frustumCulled={false}
      />
      <mesh ref={pulseRef} raycast={() => null} frustumCulled={false}>
        <sphereGeometry args={[0.035, 16, 16]} />
        <meshBasicMaterial color="#FFFFFF" toneMapped={false} />
      </mesh>
      <group ref={cloudRef} scale={cloudSize}>
        <DiscBubble working={working} />
      </group>
    </group>
  );
}

// ── Labels ──────────────────────────────────────────────────────────────────

function StationLabel({ id }: { id: StepId }) {
  const step = usePlan().stepById[id];
  const current = useJourney((state) => state.current);
  const laps = useJourney((state) => state.laps);
  const tasks = useJourney((state) => state.tasks);
  const selectedStep = useJourney((state) => state.selectedStep);
  const hoveredStep = useJourney((state) => state.hoveredStep);
  const selectStep = useJourney((state) => state.selectStep);
  const hoverStep = useJourney((state) => state.hoverStep);

  const state = stepState(id, current);
  const { done, total, flagged } = stepProgress(step, tasks);
  const selected = selectedStep === id;
  const quiet = selectedStep !== null && !selected;
  const hovered = hoveredStep === id;
  const station = STATION[id];
  // An open step's label sits under its ring, leaving the space above to Cortex.
  // Closed, some labels hang underneath so neighbours never meet.
  const below = selected || LABEL_BELOW.has(id);
  const reach = ringReach(id, selected);
  const y = below ? station.y - reach - labelLift(selected, id) : station.y + reach + labelLift(selected, id);
  const inLoop = PHASE[current] === "verification";
  // A dashed leader from the edge of the step to the label.
  const sign = below ? -1 : 1;
  // The leader runs to the step's core: the solid sphere of a closed step,
  // or the centre of an open one's disc ring.
  const leaderFrom = station.y + sign * (selected ? 0.16 : coreRadius(id));
  const leaderTo = y - sign * LEADER_GAP;
  const leaderColour = state === "current" ? "#FF9A4D" : stepProgress(step, tasks).complete ? "#FFE6B0" : "#A9ACF0";

  return (
    <group>
      <Line
        points={[
          [station.x, leaderFrom, station.z],
          [station.x, leaderTo, station.z],
        ]}
        color={leaderColour}
        lineWidth={1}
        dashed
        dashSize={0.07}
        gapSize={0.06}
        transparent
        opacity={quiet && !hovered ? 0.25 : 0.7}
        toneMapped={false}
      />
      <Html center position={[station.x, y, station.z]} zIndexRange={[22, 0]} style={{ pointerEvents: "none" }}>
        <div
          className={`flex flex-col items-center gap-1 transition-opacity duration-300 ${below ? "flex-col-reverse" : ""}`}
          style={{ opacity: quiet && !hovered ? 0.4 : 1 }}
        >
          {state === "current" && (
            <span className="rounded-full bg-[#FF8A3D] px-2 py-0.5 text-[10px] font-bold tracking-[0.14em] text-[#2A1405] uppercase shadow-[0_0_18px_rgba(255,138,61,0.55)]">
              {inLoop ? `You are here · period ${laps + 1}` : "You are here"}
            </span>
          )}
          <button
            type="button"
            data-journey-label
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => selectStep(selected ? null : id)}
            onMouseEnter={() => hoverStep(id)}
            onMouseLeave={() => hoverStep(null)}
            className={`pointer-events-auto flex items-center gap-2 whitespace-nowrap rounded-xl border px-2.5 py-1.5 text-left backdrop-blur-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
              selected
                ? "border-white bg-white text-[#1B1846]"
                : state === "upcoming"
                  ? "border-white/12 bg-[#141235]/55 text-white/70 hover:bg-[#141235]/80"
                  : "border-white/25 bg-[#1E1B4E]/65 text-white hover:bg-[#1E1B4E]/90"
            }`}
          >
            <span className="grid leading-tight">
              <span className="text-[12.5px] font-semibold">{step.label}</span>
              <span className={`text-[10.5px] ${selected ? "text-[#1B1846]/65" : "text-white/60"}`}>{step.sub}</span>
            </span>
            <span
              className={`tabular rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${
                selected ? "bg-[#1B1846]/10" : done === total ? "bg-[#FFE6B0]/20 text-[#FFE6B0]" : "bg-white/10"
              }`}
            >
              {done}/{total}
              {flagged > 0 ? <span className={selected ? "text-signal-amber" : "text-[#F7B36B]"}> · {flagged}!</span> : null}
            </span>
          </button>
        </div>
      </Html>
    </group>
  );
}

function Captions() {
  const caption = "pointer-events-none whitespace-nowrap text-[10.5px] font-semibold tracking-[0.18em] uppercase";
  const still = { pointerEvents: "none" } as const;
  return (
    <>
      <Html center position={VALIDATION_CAPTION} zIndexRange={[20, 0]} style={still}>
        <p className={`${caption} text-white/50`}>Validation · once per facility</p>
      </Html>
      <Html
        center
        position={[CREDITING_LABEL.x, CREDITING_LABEL.y, CREDITING_LABEL.z + 2.4]}
        zIndexRange={[20, 0]}
        style={still}
      >
        <p className={`${caption} text-[#FFE6B0]/70`}>Crediting period starts</p>
      </Html>
      <Html center position={VERIFICATION_CAPTION} zIndexRange={[20, 0]} style={still}>
        <p className={`${caption} text-white/50`}>Verification · every period, at most 1 year</p>
      </Html>
    </>
  );
}

// ── Materials that breathe ─────────────────────────────────────────────────

function MaterialPulse() {
  useFrame((state) => {
    const checking = discMaterials().checking as THREE.MeshStandardMaterial;
    checking.emissiveIntensity = 0.5 + 0.6 * (0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 7));
  });
  return null;
}

// ── Camera fit ──────────────────────────────────────────────────────────────

type Rect = { left: number; right: number; top: number; bottom: number };

/**
 * A point the camera must keep on screen, with the pixels an HTML label at
 * that point reaches past it (labels keep their size however far the camera is).
 */
type FitPoint = { p: THREE.Vector3; l: number; r: number; t: number; b: number };

const at = (p: THREE.Vector3, l = 0, r = l, t = 0, b = t): FitPoint => ({ p, l, r, t, b });

/** A step label is about 250 px wide at most; the current one has a pill above it. */
const LABEL_HALF = 128;

/** Points a step needs on screen: its ring, its label, and Cortex above it. */
function stepPoints(id: StepId, selected: boolean, withOrb: boolean): FitPoint[] {
  const station = STATION[id];
  const reach = ringReach(id, selected);
  const below = LABEL_BELOW.has(id);
  const labelY = below ? station.y - reach - labelLift(selected, id) : station.y + reach + labelLift(selected, id);
  const points = [
    at(new THREE.Vector3(station.x - reach - 0.2, station.y, station.z)),
    at(new THREE.Vector3(station.x + reach + 0.2, station.y, station.z)),
    at(new THREE.Vector3(station.x, station.y - reach - 0.1, station.z)),
    at(new THREE.Vector3(station.x, station.y + reach + 0.1, station.z)),
    at(new THREE.Vector3(station.x, labelY, station.z), LABEL_HALF, LABEL_HALF, below ? 22 : 46, below ? 46 : 22),
  ];
  if (withOrb) points.push(at(orbPosition(id, selected, new THREE.Vector3()).add(new THREE.Vector3(0, 0.6, 0))));
  return points;
}

/** Points an open step needs: its ring, its label underneath, and Cortex above with its pins. */
function focusPoints(id: StepId, polar: number, azimuth: number): FitPoint[] {
  const station = STATION[id];
  const reach = ringReach(id, true);
  const side = new THREE.Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth));
  const up = viewUp(polar, azimuth, new THREE.Vector3());
  const orb = focusOrbPosition(id, up, new THREE.Vector3());
  const shell = ORB_FOCUS_SCALE * SHELL;
  // The label hangs straight down in world space (see StationLabel).
  const label = new THREE.Vector3(station.x, station.y - reach - labelLift(true), station.z);
  const pins = openPinCount();
  const half = (pins * PIN_LABEL_SPACING) / 2 + 6;
  return [
    at(station.clone().addScaledVector(side, reach + 0.3)),
    at(station.clone().addScaledVector(side, -(reach + 0.3))),
    at(station.clone().addScaledVector(up, -(reach + 0.2))),
    at(label, LABEL_HALF, LABEL_HALF, 22, 46),
    at(orb.clone().addScaledVector(up, shell + 0.3)),
    // Pin labels stack in a column left of the pins, about 220 px wide.
    ...(pins > 0
      ? [at(orb.clone().addScaledVector(side, -(shell * 1.42 + PIN_LEAD)).addScaledVector(up, shell * 0.35), 224, 0, half, half)]
      : []),
  ];
}

/** Everything the overview must show; ring sizes follow the plan, so it is rebuilt each frame. */
function overviewPoints(): FitPoint[] {
  return [
    ...STEP_ORDER.flatMap((id) => stepPoints(id, false, false)),
    at(VALIDATION_CAPTION.clone(), 125, 125, 10, 10),
    at(VERIFICATION_CAPTION.clone(), 168, 168, 10, 10),
  ];
}

const scratch = new THREE.PerspectiveCamera();
const probe = new THREE.Vector3();
const offset = new THREE.Vector3();
const right = new THREE.Vector3();
const toward = new THREE.Vector3();

/**
 * Find the look target and distance that put `points` inside `rect`
 * (screen pixels), scaled to fill `fill` of it, for this camera angle.
 */
function fitView(
  points: FitPoint[],
  rect: Rect,
  fill: number,
  width: number,
  height: number,
  fov: number,
  polar: number,
  azimuth: number,
  target: THREE.Vector3,
): number {
  scratch.fov = fov;
  scratch.aspect = width / Math.max(height, 1);
  scratch.near = 0.1;
  scratch.far = 400;
  scratch.updateProjectionMatrix();
  right.set(Math.cos(azimuth), 0, -Math.sin(azimuth));
  toward.set(Math.sin(azimuth), 0, Math.cos(azimuth));
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const elevation = Math.max(0.25, Math.PI / 2 - polar);
  const availW = Math.max(rect.right - rect.left, 80) * fill;
  const availH = Math.max(rect.bottom - rect.top, 80) * fill;
  let distance = 18;

  for (let i = 0; i < 7; i++) {
    offset.setFromSphericalCoords(distance, polar, azimuth);
    scratch.position.copy(target).add(offset);
    scratch.lookAt(target);
    scratch.updateMatrixWorld();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      probe.copy(point.p).project(scratch);
      const x = ((probe.x + 1) / 2) * width;
      const y = ((1 - probe.y) / 2) * height;
      minX = Math.min(minX, x - point.l);
      maxX = Math.max(maxX, x + point.r);
      minY = Math.min(minY, y - point.t);
      maxY = Math.max(maxY, y + point.b);
    }
    const pxPerUnit = height / (2 * tanHalf * distance);
    const dx = (rect.left + rect.right) / 2 - (minX + maxX) / 2;
    const dy = (rect.top + rect.bottom) / 2 - (minY + maxY) / 2;
    target.addScaledVector(right, -dx / pxPerUnit);
    target.addScaledVector(toward, -dy / (pxPerUnit * Math.sin(elevation)));
    const scale = Math.max((maxX - minX) / availW, (maxY - minY) / availH);
    distance = THREE.MathUtils.clamp(distance * THREE.MathUtils.clamp(scale, 0.6, 1.6), 4, 60);
  }
  return distance;
}

// ── Rig: frames the journey, or one step beside the panel ──────────────────

function Rig({ controlRef }: { controlRef: MutableRefObject<ViewControl> }) {
  const selected = useJourney((state) => state.selectedStep);
  const current = useJourney((state) => state.current);
  const lookRef = useRef<THREE.Vector3 | null>(null);
  const goalRef = useRef<THREE.Vector3 | null>(null);
  const distance = useRef(20);
  const camOffset = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, delta) => {
    const d = Math.min(delta, 0.1);
    const camera = state.camera as THREE.PerspectiveCamera;
    const { width, height } = state.size;
    const control = controlRef.current;
    const wide = width >= 1024;
    const goal = (goalRef.current ??= OVERVIEW_TARGET.clone());

    let fitted: number;
    if (selected) {
      // The left column folds away while a step is open, so the step has the
      // width up to the panel (or the space above the sheet).
      const panel = Math.min(470, width * 0.42) + 20;
      const rect: Rect = wide
        ? { left: 40, right: width - panel - 20, top: 76, bottom: height - 20 }
        : { left: 16, right: width - 16, top: 16, bottom: height * 0.36 };
      goal.copy(STATION[selected]);
      fitted = fitView(focusPoints(selected, control.polar, control.azimuth), rect, 0.9, width, height, camera.fov, control.polar, control.azimuth, goal);
    } else {
      const rect: Rect = wide
        ? { left: 350, right: width - 28, top: 96, bottom: height - 92 }
        : { left: 16, right: width - 16, top: height * 0.42, bottom: height - 16 };
      goal.copy(OVERVIEW_TARGET);
      const points = [...overviewPoints(), at(orbPosition(current, false, new THREE.Vector3()).add(new THREE.Vector3(0, 0.6, 0)))];
      fitted = fitView(points, rect, 1, width, height, camera.fov, control.polar, control.azimuth, goal);
    }

    const look = (lookRef.current ??= goal.clone());
    look.x = THREE.MathUtils.damp(look.x, goal.x, 2.6, d);
    look.y = THREE.MathUtils.damp(look.y, goal.y, 2.6, d);
    look.z = THREE.MathUtils.damp(look.z, goal.z, 2.6, d);
    distance.current = THREE.MathUtils.damp(distance.current, fitted * control.zoom, 2.4, d);
    camOffset.setFromSphericalCoords(distance.current, control.polar, control.azimuth);
    camera.position.copy(look).add(camOffset);
    camera.lookAt(look);
  });

  return null;
}

// ── Scene ───────────────────────────────────────────────────────────────────

export function JourneyScene() {
  const steps = usePlan().steps;
  const selectStep = useJourney((state) => state.selectStep);
  const hoveredStep = useJourney((state) => state.hoveredStep);
  const controlRef = useRef<ViewControl>({
    azimuth: 0,
    polar: BASE_POLAR,
    zoom: 1,
    dragging: false,
    moved: 0,
  });
  const [reduced, setReduced] = useState(false);

  // Materials are shared across mounts (the pulse animates one of them).
  const materials = useMemo(() => discMaterials(), []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const control = controlRef.current;
    control.dragging = true;
    control.moved = 0;
    let lastX = event.clientX;
    let lastY = event.clientY;
    const move = (e: PointerEvent) => {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      control.moved += Math.abs(dx) + Math.abs(dy);
      control.azimuth = THREE.MathUtils.clamp(control.azimuth - dx * 0.004, -0.9, 0.9);
      control.polar = THREE.MathUtils.clamp(control.polar - dy * 0.003, 0.45, 1.25);
    };
    const up = () => {
      control.dragging = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const control = controlRef.current;
    control.zoom = THREE.MathUtils.clamp(control.zoom * (1 + event.deltaY * 0.0012), 0.45, 1.6);
  };

  return (
    <div
      className={`absolute inset-0 touch-none select-none ${hoveredStep ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}`}
      onPointerDown={onPointerDown}
      onWheel={onWheel}
    >
      <Canvas
        flat
        dpr={[1, 2]}
        camera={{ position: [0, 11, 15], fov: 36, near: 0.1, far: 200 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onPointerMissed={(event) => {
          const target = event.target as Element | null;
          if (target?.closest?.("[data-journey-label]")) return;
          if (controlRef.current.moved > DRAG_SLOP) return;
          selectStep(null);
        }}
      >
        <Backdrop />
        <ambientLight intensity={0.3} color="#9A93FF" />
        <directionalLight position={[6, 9, 7]} intensity={2} color="#FFF3DE" />
        <directionalLight position={[-7, 4, -6]} intensity={1.8} color="#8C7BFF" />
        <directionalLight position={[0, -3, 8]} intensity={0.6} color="#B7A8FF" />
        {/* Coloured light panels: the metal rings reflect them as iridescent streaks. */}
        <Environment resolution={256} frames={1}>
          <Lightformer form="rect" intensity={2.4} color="#B7A8FF" position={[0, 5, -6]} scale={[12, 4, 1]} />
          <Lightformer form="rect" intensity={1.6} color="#FFE6C2" position={[6, 3, 6]} scale={[6, 3, 1]} />
          <Lightformer form="circle" intensity={1.2} color="#5D57E8" position={[-6, -2, 4]} scale={4} />
          <Lightformer form="rect" intensity={3} color="#3FD8E8" position={[8, 0, 2]} rotation-y={-Math.PI / 2} scale={[8, 1.2, 1]} />
          <Lightformer form="rect" intensity={2.6} color="#FF9A4D" position={[-8, 1, 1]} rotation-y={Math.PI / 2} scale={[6, 0.9, 1]} />
          <Lightformer form="rect" intensity={2.4} color="#4D7CFF" position={[0, -6, 3]} rotation-x={-Math.PI / 2} scale={[10, 1.4, 1]} />
          <Lightformer form="ring" intensity={2} color="#E8F2FF" position={[0, 0, 9]} scale={3} />
        </Environment>

        <GroundDots />
        <Paths />
        {steps.map((step) => (
          <StepGyro key={`gyro:${step.id}`} step={step} reduced={reduced} />
        ))}
        {steps.map((step) => (
          <DiscRing
            key={step.id}
            step={step}
            materials={materials}
            reduced={reduced}
          />
        ))}
        {steps.map((step) => (
          <StationLabel key={step.id} id={step.id} />
        ))}
        <Captions />
        <Marker reduced={reduced} />
        <CortexFollower reduced={reduced} />
        <CortexLink reduced={reduced} />
        <MaterialPulse />
        <Rig controlRef={controlRef} />

        <EffectComposer>
          <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.88} luminanceSmoothing={0.18} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
