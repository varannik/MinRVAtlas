"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Billboard, Html } from "@react-three/drei";
import * as THREE from "three";

import { stepState } from "@/lib/journey/steps";
import type { JourneyStep, TaskStatus } from "@/lib/journey/types";
import { currentPlan, taskState, usePlan, useJourney } from "@/store/journey-store";
import { STATION } from "./layout";

/**
 * A step as a ring of thin discs, one disc per thing Cortex needs: a step
 * with seven tasks shows seven discs. Done discs glow warm, discs with an
 * open question glow amber, the rest stay dark indigo. The ring faces the
 * viewer; each disc is a slice around it, turned so its face catches light.
 */

const DISC_THICKNESS = 0.024;
const DISC_TILT = 0.72;
/** Ring leans back a little so it reads as an object, not a badge. */
const RING_LEAN = 0.32;
/** Pointer travel (px) above which a press counts as a drag, not a click. */
export const DRAG_SLOP = 6;

/** The verified project is the hub, so it is drawn larger. */
export function stationScale(id: JourneyStep["id"]): number {
  return id === "listed" ? 1.3 : 1;
}

/** Ring radius grows with the number of discs so they keep their spacing. */
export function ringRadius(count: number): number {
  return THREE.MathUtils.clamp(count * 0.085, 0.45, 0.78);
}

/** Disc size: about a third of the spacing, so each disc reads on its own. */
export function discRadius(count: number): number {
  const spacing = (Math.PI * 2 * ringRadius(count)) / count;
  return THREE.MathUtils.clamp(spacing * 0.36, 0.15, 0.26);
}

/** How many discs a step has in the plan the answers point to now. */
function taskCount(id: JourneyStep["id"]): number {
  return currentPlan().stepById[id].tasks.length;
}

/** Outer reach of a ring from its centre, in world units. */
export function ringReach(id: JourneyStep["id"], selected = false): number {
  const count = taskCount(id);
  return (ringRadius(count) + discRadius(count)) * stationScale(id) * (selected ? 1.2 : 1);
}

/** World size of one disc, as drawn now (the open ring and its chosen disc are larger). */
export function discReach(id: JourneyStep["id"], selected: boolean): number {
  return discRadius(taskCount(id)) * stationScale(id) * (selected ? 1.2 * 1.16 : 1);
}

/** Each disc's object, by task id, so Cortex can find and point at it. */
export const discRegistry = new Map<string, THREE.Object3D>();

/** Disc angles: the first task at the top, then clockwise. */
function discAngles(count: number): number[] {
  return Array.from({ length: count }, (_, index) => Math.PI / 2 - (index / count) * Math.PI * 2);
}

export type DiscMaterials = Record<
  | "lit"
  | "litHot"
  | "amber"
  | "amberHot"
  | "open"
  | "openHot"
  | "locked"
  | "lockedHot"
  | "checking"
  | "rimLit"
  | "rimAmber"
  | "rimOpen"
  | "rimLocked",
  THREE.Material
>;

export function createDiscMaterials(): DiscMaterials {
  const glow = (color: string, emissive: string, intensity: number) =>
    new THREE.MeshPhysicalMaterial({
      color,
      emissive,
      emissiveIntensity: intensity,
      roughness: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.25,
      toneMapped: false,
    });
  const indigo = (color: string, emissive: string, intensity: number) =>
    new THREE.MeshPhysicalMaterial({
      color,
      emissive,
      emissiveIntensity: intensity,
      roughness: 0.28,
      metalness: 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.15,
    });

  const rim = (color: string, opacity: number) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, toneMapped: false });

  return {
    lit: glow("#FFF0D2", "#FFDB94", 0.55),
    litHot: glow("#FFF6E4", "#FFE2A6", 0.95),
    amber: glow("#F6AE63", "#E07A24", 0.42),
    amberHot: glow("#FFC27E", "#EC8A35", 0.75),
    // Light periwinkle for "to do", mid indigo for later steps: both stand
    // clear of the near-black background.
    open: indigo("#8F93FF", "#3B3CB0", 0.6),
    openHot: indigo("#B6B9FF", "#5254D6", 0.85),
    locked: indigo("#6266C4", "#25246E", 0.55),
    lockedHot: indigo("#8487E4", "#34338E", 0.8),
    checking: glow("#D9D1FF", "#9C8CFF", 0.8),
    // A thin light edge on every disc keeps its outline crisp on the dark.
    rimLit: rim("#FFF4DC", 0.7),
    rimAmber: rim("#FFD3A3", 0.7),
    rimOpen: rim("#D6D8FF", 0.75),
    rimLocked: rim("#A9ACF0", 0.5),
  };
}

let shared: DiscMaterials | null = null;

/** One set of disc materials for every ring, made on first use. */
export function discMaterials(): DiscMaterials {
  shared ??= createDiscMaterials();
  return shared;
}

function materialFor(
  status: TaskStatus,
  upcoming: boolean,
  hot: boolean,
  materials: DiscMaterials,
): THREE.Material {
  if (status === "checking") return materials.checking;
  if (status === "done") return hot ? materials.litHot : materials.lit;
  if (status === "flagged") return hot ? materials.amberHot : materials.amber;
  if (upcoming) return hot ? materials.lockedHot : materials.locked;
  return hot ? materials.openHot : materials.open;
}

function rimFor(status: TaskStatus, upcoming: boolean, materials: DiscMaterials): THREE.Material {
  if (status === "done") return materials.rimLit;
  if (status === "flagged") return materials.rimAmber;
  if (status === "checking") return materials.rimOpen;
  return upcoming ? materials.rimLocked : materials.rimOpen;
}

const STATUS_WORD: Record<TaskStatus, string> = {
  open: "To do",
  checking: "Cortex is checking",
  flagged: "Cortex has a question",
  done: "Done",
};

function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  return ((((angle + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
}

export function DiscRing({
  step,
  materials,
  reduced,
}: {
  step: JourneyStep;
  materials: DiscMaterials;
  reduced: boolean;
}) {
  const current = useJourney((state) => state.current);
  const tasks = useJourney((state) => state.tasks);
  const selectedStep = useJourney((state) => state.selectedStep);
  const selectedTask = useJourney((state) => state.selectedTask);
  const hoveredTask = useJourney((state) => state.hoveredTask);
  const selectStep = useJourney((state) => state.selectStep);
  const selectTask = useJourney((state) => state.selectTask);
  const hoverStep = useJourney((state) => state.hoverStep);
  const hoverTask = useJourney((state) => state.hoverTask);
  const credit = usePlan().credit.many;

  const state = stepState(step.id, current);
  const upcoming = state === "upcoming";
  const isSelected = selectedStep === step.id;
  // Closed steps are drawn as a gyroscope (step-gyro.tsx). The discs exist only
  // while the step is open, and while they shrink away after it closes.
  const [shown, setShown] = useState(isSelected);
  if (isSelected && !shown) setShown(true);
  const scale = stationScale(step.id);

  const scaleRef = useRef<THREE.Group>(null);
  const spinRef = useRef<THREE.Group>(null);
  const discRefs = useRef<(THREE.Group | null)[]>([]);

  const count = step.tasks.length;
  const radius = ringRadius(count);
  const angles = useMemo(() => discAngles(count), [count]);
  const { geometry, edge } = useMemo(() => {
    const r = discRadius(count);
    return {
      geometry: new THREE.CylinderGeometry(r, r, DISC_THICKNESS, 48, 1),
      edge: new THREE.TorusGeometry(r, 0.009, 6, 64),
    };
  }, [count]);
  useEffect(
    () => () => {
      geometry.dispose();
      edge.dispose();
    },
    [geometry, edge],
  );
  const selectedIndex = step.tasks.findIndex((task) => task.id === selectedTask);
  const hoveredIndex = step.tasks.findIndex((task) => task.id === hoveredTask);

  useFrame((_, delta) => {
    const d = Math.min(delta, 0.1);
    const spin = spinRef.current;
    if (spin) {
      if (isSelected && selectedIndex >= 0) {
        // Turn the chosen task's disc to the top of the ring, under Cortex.
        const target = Math.PI / 2 - angles[selectedIndex];
        spin.rotation.z += wrapAngle(target - spin.rotation.z) * (1 - Math.exp(-5 * d));
      } else if (state === "current" && !reduced && hoveredIndex < 0) {
        spin.rotation.z -= d * 0.1;
      }
    }
    const ring = scaleRef.current;
    if (ring) {
      ring.scale.setScalar(THREE.MathUtils.damp(ring.scale.x, isSelected ? scale * 1.2 : 0.001, 6, d));
      if (!isSelected && ring.scale.x < 0.02) setShown(false);
    }
    discRefs.current.forEach((disc, index) => {
      if (!disc) return;
      const chosen = isSelected && index === selectedIndex;
      const hot = index === hoveredIndex || chosen;
      disc.scale.setScalar(THREE.MathUtils.damp(disc.scale.x, hot ? 1.16 : 1, 10, d));
      disc.position.x = THREE.MathUtils.damp(disc.position.x, hot ? 0.06 : 0, 10, d);
      // The disc Cortex is linked to turns its face to the viewer.
      disc.rotation.x = THREE.MathUtils.damp(disc.rotation.x, chosen ? 0.8 : 0, 8, d);
    });
  });

  const onRingClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.delta > DRAG_SLOP) return;
    selectStep(step.id);
  };

  // The disc Cortex is linked to is already named in the panel, so it gets no tooltip.
  const tip = hoveredIndex >= 0 && !(isSelected && hoveredIndex === selectedIndex) ? step.tasks[hoveredIndex] : null;
  const tipStatus = tip ? taskState(tasks, tip.id).status : "open";
  const tipAngle = hoveredIndex >= 0 ? angles[hoveredIndex] : 0;

  if (!shown) return null;

  return (
    <group position={STATION[step.id]}>
      <Billboard>
        <group ref={scaleRef} scale={0.001} rotation={[RING_LEAN, 0, 0]}>
          {/* Hit area for the whole step. */}
          <mesh
            onClick={onRingClick}
            onPointerOver={(event) => {
              event.stopPropagation();
              hoverStep(step.id);
            }}
            onPointerOut={() => hoverStep(null)}
          >
            <circleGeometry args={[radius + discRadius(count) + 0.05, 40]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>

          {state !== "current" && (
            <mesh raycast={() => null}>
              <sphereGeometry args={[0.06, 20, 20]} />
              <meshBasicMaterial color={upcoming ? "#6266C4" : "#FFE9B8"} toneMapped={false} />
            </mesh>
          )}

          <group ref={spinRef}>
            {step.tasks.map((task, index) => {
              const angle = angles[index];
              const status = taskState(tasks, task.id).status;
              const hot = index === hoveredIndex || (isSelected && index === selectedIndex);
              return (
                <group
                  key={task.id}
                  position={[Math.cos(angle) * radius, Math.sin(angle) * radius, 0]}
                  rotation={[0, 0, angle]}
                >
                  <group
                    ref={(node) => {
                      discRefs.current[index] = node;
                      if (node) discRegistry.set(task.id, node);
                      else discRegistry.delete(task.id);
                    }}
                  >
                    <group rotation={[DISC_TILT, 0, 0]}>
                      <mesh
                        geometry={geometry}
                        material={materialFor(status, upcoming, hot, materials)}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (event.delta > DRAG_SLOP) return;
                          selectTask(task.id);
                        }}
                        onPointerOver={(event) => {
                          event.stopPropagation();
                          hoverStep(step.id);
                          hoverTask(task.id);
                        }}
                        onPointerOut={() => {
                          hoverTask(null);
                          hoverStep(null);
                        }}
                      />
                      <mesh
                        geometry={edge}
                        material={rimFor(status, upcoming, materials)}
                        rotation={[Math.PI / 2, 0, 0]}
                        raycast={() => null}
                      />
                    </group>
                  </group>
                </group>
              );
            })}

            {tip ? (
              <group position={[Math.cos(tipAngle) * (radius + 0.6), Math.sin(tipAngle) * (radius + 0.6), 0]}>
                <Html center zIndexRange={[24, 0]} style={{ pointerEvents: "none" }}>
                  <div className="whitespace-nowrap rounded-lg border border-white/20 bg-[#141235]/85 px-2.5 py-1.5 text-white shadow-lg backdrop-blur-md">
                    <p className="text-[12px] font-semibold">{tip.label}</p>
                    <p className="text-[10.5px] text-white/70">
                      {STATUS_WORD[tipStatus]}
                      {tip.optional ? " · optional" : ""}
                      {tip.blocks && tipStatus !== "done" ? ` · blocks ${credit}` : ""}
                    </p>
                  </div>
                </Html>
              </group>
            ) : null}
          </group>
        </group>
      </Billboard>
    </group>
  );
}

