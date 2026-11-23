import * as THREE from "three";

import type { StepId } from "@/lib/journey/types";

/**
 * Where each step sits on the top floor, facility validation. The one-off
 * steps run left to right on a gentle arc that bows away from the viewer, and
 * end at the validated project, drawn a little raised as the hub. Monitoring
 * periods live on the floor below (the removal ledger), so the verification
 * steps have no station here. Ground is y = 0; +z faces the viewer.
 */

export const HUB_HEIGHT = 0.45;

/** Gap between steps along the arc, in world units. */
const STEP_GAP = 3.7;
/** How far the middle of the arc sits behind its ends. */
const BOW = 1.5;

/** The steps drawn on the validation floor, in order. */
export const FLOOR_STEPS = ["setup", "methodology", "onboarding", "package", "validation", "listed"] as const;
const ON_FLOOR = new Set<StepId>(FLOOR_STEPS);

/** Whether a step has a station on the validation floor. */
export function onValidationFloor(id: StepId | null | undefined): id is (typeof FLOOR_STEPS)[number] {
  return Boolean(id && ON_FLOOR.has(id));
}

function arcPoint(index: number): THREE.Vector3 {
  const last = FLOOR_STEPS.length - 1;
  const t = index / last;
  return new THREE.Vector3((index - last / 2) * STEP_GAP, index === last ? HUB_HEIGHT : 0, -BOW * Math.sin(Math.PI * t));
}

const FLOOR_STATION = Object.fromEntries(FLOOR_STEPS.map((id, index) => [id, arcPoint(index)])) as Record<
  (typeof FLOOR_STEPS)[number],
  THREE.Vector3
>;

/**
 * Every step's station. Verification steps share the hub's: they are not
 * drawn here, and Cortex waits over the hub while the project is in them.
 */
export const STATION: Record<StepId, THREE.Vector3> = {
  ...FLOOR_STATION,
  monitor: FLOOR_STATION.listed.clone(),
  report: FLOOR_STATION.listed.clone(),
  audit: FLOOR_STATION.listed.clone(),
  issued: FLOOR_STATION.listed.clone(),
};

/** The validation path: a smooth curve through every station into the hub. */
export const VALIDATION_CURVE = new THREE.CatmullRomCurve3(
  FLOOR_STEPS.map((id) => FLOOR_STATION[id].clone()),
  false,
  "centripetal",
);

/** How far along the path (by length, 0–1) each station sits: the path lights up to the current one. */
export const VALIDATION_U: Partial<Record<StepId, number>> = (() => {
  const samples = 600;
  const points = Array.from({ length: samples + 1 }, (_, i) => VALIDATION_CURVE.getPointAt(i / samples));
  return Object.fromEntries(
    FLOOR_STEPS.map((id) => {
      let best = 0;
      let bestDistance = Infinity;
      points.forEach((point, i) => {
        const distance = point.distanceToSquared(FLOOR_STATION[id]);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i / samples;
        }
      });
      return [id, best];
    }),
  );
})();

/** Ground caption, under the start of the arc and below the labels that hang under it. */
export const VALIDATION_CAPTION = new THREE.Vector3(FLOOR_STATION.setup.x + STEP_GAP * 0.6, 0, 3.4);

/** Middle of the floor, to seed the camera fit and centre the ground. */
export const OVERVIEW_TARGET = new THREE.Vector3(0, 0.2, -BOW * 0.5);
