import * as THREE from "three";

import type { StepId } from "@/lib/journey/types";

/**
 * Where each step sits, following the process sketch: the one-off steps on
 * a straight line that runs into the centre of the verified project, which
 * sits a little raised in the middle of the monitoring loop. Ground is
 * y = 0; +z faces the viewer.
 */

export const LOOP_CENTER = new THREE.Vector3(0, 0, 0);
export const LOOP_RADIUS = 4.2;
export const HUB_HEIGHT = 0.45;

/** Gap between one-off steps on the line, in world units. */
const STEP_GAP = 4.6;

/** The one-off steps, in order along the line into the hub. */
const LINE_STEPS = ["setup", "methodology", "onboarding", "package", "validation"] as const;

/**
 * Angle (degrees) on the loop, as on the sketch: 0 = right, 90 = far side.
 * A quarter turn apart, and clear of the line, which comes in at 180.
 */
const LOOP_ANGLE = { monitor: 135, report: 45, audit: -45, issued: -135 } as const;

function onLoop(degrees: number, y = 0): THREE.Vector3 {
  const t = THREE.MathUtils.degToRad(degrees);
  return new THREE.Vector3(
    LOOP_CENTER.x + LOOP_RADIUS * Math.cos(t),
    y,
    LOOP_CENTER.z - LOOP_RADIUS * Math.sin(t),
  );
}

const HUB = new THREE.Vector3(LOOP_CENTER.x, HUB_HEIGHT, LOOP_CENTER.z);
/** The last one-off step sits a little outside the loop; the line starts a gap per step before it. */
const LAST_X = LOOP_CENTER.x - LOOP_RADIUS - STEP_GAP * 0.78;
const LINE_START = new THREE.Vector3(LAST_X - STEP_GAP * (LINE_STEPS.length - 1), 0, LOOP_CENTER.z);
const LINE_LENGTH = HUB.x - LINE_START.x;

/** A point on the straight line from the first step to the hub (0 = start, 1 = hub). */
function onLine(t: number): THREE.Vector3 {
  return LINE_START.clone().lerp(HUB, t);
}

const LINE_T = {
  ...Object.fromEntries(LINE_STEPS.map((id, index) => [id, (STEP_GAP * index) / LINE_LENGTH])),
  listed: 1,
} as Record<(typeof LINE_STEPS)[number] | "listed", number>;

export const STATION: Record<StepId, THREE.Vector3> = {
  setup: onLine(LINE_T.setup),
  methodology: onLine(LINE_T.methodology),
  onboarding: onLine(LINE_T.onboarding),
  package: onLine(LINE_T.package),
  validation: onLine(LINE_T.validation),
  listed: HUB.clone(),
  monitor: onLoop(LOOP_ANGLE.monitor),
  report: onLoop(LOOP_ANGLE.report),
  audit: onLoop(LOOP_ANGLE.audit),
  issued: onLoop(LOOP_ANGLE.issued),
};

/** Validation path: one straight line through each one-off step into the hub. */
export const VALIDATION_CURVE = new THREE.LineCurve3(STATION.setup.clone(), STATION.listed.clone());

/** The loop, starting at Monitor and running the way the sketch's arrows go. */
export const LOOP_CURVE = (() => {
  const points: THREE.Vector3[] = [];
  const count = 96;
  for (let i = 0; i < count; i++) points.push(onLoop(LOOP_ANGLE.monitor - (i / count) * 360));
  return new THREE.CatmullRomCurve3(points, true, "catmullrom", 0.5);
})();

export const VALIDATION_U: Partial<Record<StepId, number>> = { ...LINE_T };

export const LOOP_U: Partial<Record<StepId, number>> = {
  monitor: 0,
  report: (LOOP_ANGLE.monitor - LOOP_ANGLE.report) / 360,
  audit: (LOOP_ANGLE.monitor - LOOP_ANGLE.audit) / 360,
  issued: (LOOP_ANGLE.monitor - LOOP_ANGLE.issued) / 360,
};

/** Where the crediting period starts: on the line, just before it crosses into the loop. */
export const CREDITING_LABEL = onLine((LAST_X + STEP_GAP * 0.5 - LINE_START.x) / LINE_LENGTH);

/** Ground captions for the two phases. */
/** Under the start of the line, below the labels that hang under it. */
export const VALIDATION_CAPTION = new THREE.Vector3(LINE_START.x + STEP_GAP * 0.5, 0, LOOP_CENTER.z + 4.6);
/** In front of the loop, to the right of the label that hangs under Credits issued. */
export const VERIFICATION_CAPTION = new THREE.Vector3(LOOP_CENTER.x + 3.4, 0, LOOP_CENTER.z + LOOP_RADIUS + 1.9);

/** Middle of everything, to seed the camera fit and centre the ground. */
export const OVERVIEW_TARGET = new THREE.Vector3((LINE_START.x + LOOP_CENTER.x + LOOP_RADIUS) / 2, 0.2, 0);
