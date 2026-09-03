"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BRAND } from "@/lib/brand";
import { useDashboard } from "@/store/dashboard-store";
import { dragState } from "./drag-state";
import { boardSlot, requirementAnchor } from "./requirement-anchor";
import { boardSlotPose } from "./layout";
import {
  BOARD_D,
  BOARD_H,
  BOARD_W,
  PUCK_DEPTH,
  PUCK_SIZE,
  PX,
  STATE_COLOR,
  STATE_EMISSIVE,
  buildBoardLayout,
  createBoardTexture,
  puckLocal,
  pxToLocal,
  type BoardLayout,
  type BoardRow,
} from "./board-face";
import type { RequirementItem, SubmissionBatch } from "@/lib/types";

/**
 * Rest pose copies the camera so the face is square on screen. Extra motion
 * only while the pointer is on the slab, lagged so it reads like a card
 * floating on liquid.
 */
const TILT_YAW = 0.07;
const TILT_PITCH = 0.048;
const DRIFT = 0.018;
const AIM_DAMP = 2.6;
const POSE_DAMP = 1.35;

const BOARD_Y = 0;
const SLOT_PLANE_Z = 0.45;

function roundedPlate(
  width: number,
  height: number,
  depth: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2 - 0.001, height / 2 - 0.001);
  const x = -width / 2;
  const y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 6,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

const FACE_GEOMETRY = new THREE.PlaneGeometry(BOARD_W, BOARD_H);
const PUCK_GEOMETRY = roundedPlate(PUCK_SIZE, PUCK_SIZE, PUCK_DEPTH, 0.02);

const FACE_Z = BOARD_D / 2 + 0.002;
const PUCK_Z = FACE_Z + PUCK_DEPTH / 2;

function StatusChip({
  item,
  position,
  register,
}: {
  item: RequirementItem;
  position: [number, number];
  register: (mesh: THREE.Mesh | null) => void;
}) {
  const hoverSlot = useDashboard((state) => state.hoverSlot);
  const selectRequirement = useDashboard((state) => state.selectRequirement);
  const color = STATE_COLOR[item.state];
  const missing = item.state === "missing";

  return (
    <mesh
      ref={register}
      geometry={PUCK_GEOMETRY}
      position={[position[0], position[1], PUCK_Z]}
      onClick={(event) => {
        event.stopPropagation();
        if (dragState.moved) return;
        selectRequirement(item.slotId);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        hoverSlot(item.slotId);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        hoverSlot(null);
        document.body.style.cursor = "auto";
      }}
    >
      {missing ? (
        <meshBasicMaterial color={BRAND.shale} wireframe transparent opacity={0.85} />
      ) : (
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={STATE_EMISSIVE[item.state]}
          metalness={0.08}
          roughness={0.46}
        />
      )}
    </mesh>
  );
}

function RowHit({
  item,
  layout,
  row,
}: {
  item: RequirementItem;
  layout: BoardLayout;
  row: BoardRow;
}) {
  const hoverSlot = useDashboard((state) => state.hoverSlot);
  const selectRequirement = useDashboard((state) => state.selectRequirement);
  const selected = useDashboard((state) => state.selectedSlotId === item.slotId);
  const [x, y] = pxToLocal(
    layout.columnX[row.column] + layout.columnWidth / 2,
    row.y,
  );
  const w = layout.columnWidth / PX;
  const h = layout.rowStep / PX;

  return (
    <group position={[x, y, FACE_Z + 0.006]}>
      {selected ? (
        <mesh raycast={() => null}>
          <planeGeometry args={[w - 0.02, h - 0.01]} />
          <meshBasicMaterial
            color={item.accent}
            transparent
            opacity={0.24}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ) : null}
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          if (dragState.moved) return;
          selectRequirement(item.slotId);
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          hoverSlot(item.slotId);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          hoverSlot(null);
          document.body.style.cursor = "auto";
        }}
      >
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial
          transparent
          opacity={0}
          depthWrite={false}
          colorWrite={false}
        />
      </mesh>
    </group>
  );
}

function RequirementBoard({ batch }: { batch: SubmissionBatch }) {
  const groupRef = useRef<THREE.Group>(null);
  const faceMat = useRef<THREE.MeshBasicMaterial>(null);
  const chipRefs = useRef<(THREE.Mesh | null)[]>([]);
  const hovering = useRef(false);
  const posed = useRef(false);
  const pointer = useRef({ x: 0, y: 0 });
  const aim = useRef({ x: 0, y: 0 });
  const scratch = useRef({
    raycaster: new THREE.Raycaster(),
    hitPlane: new THREE.Plane(),
    hitPoint: new THREE.Vector3(),
    worldNormal: new THREE.Vector3(),
    worldPoint: new THREE.Vector3(),
    offset: new THREE.Vector3(),
    camRight: new THREE.Vector3(),
    camUp: new THREE.Vector3(),
    parentWorldQuat: new THREE.Quaternion(),
    camLocalQuat: new THREE.Quaternion(),
    restEuler: new THREE.Euler(0, 0, 0, "YXZ"),
    ndc: new THREE.Vector3(),
  });
  const { gl } = useThree();
  const hoveredSlotId = useDashboard((state) => state.hoveredSlotId);
  const selectedSlotId = useDashboard((state) => state.selectedSlotId);

  const layout = useMemo<BoardLayout>(() => buildBoardLayout(batch), [batch]);
  const texture = useMemo(
    () => createBoardTexture(batch, layout),
    [batch, layout],
  );
  const itemRows = useMemo(
    () => layout.rows.filter((row): row is BoardRow => row.kind === "item"),
    [layout],
  );

  useEffect(
    () => () => {
      texture.dispose();
      requirementAnchor.valid = false;
    },
    [texture],
  );

  const hoveredIndex = batch.items.findIndex(
    (item) => item.slotId === hoveredSlotId,
  );
  const selectedIndex = batch.items.findIndex(
    (item) => item.slotId === selectedSlotId,
  );

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const step = Math.min(delta, 0.1);
    const s = scratch.current;
    const parent = group.parent;
    if (parent) parent.updateWorldMatrix(true, false);
    const receded = Boolean(selectedSlotId);
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (parent) {
      parent.getWorldQuaternion(s.parentWorldQuat);
    } else {
      s.parentWorldQuat.identity();
    }
    s.camLocalQuat
      .copy(s.parentWorldQuat)
      .invert()
      .multiply(state.camera.quaternion);
    s.restEuler.setFromQuaternion(s.camLocalQuat, "YXZ");

    s.worldPoint.set(0, 0, FACE_Z).applyMatrix4(group.matrixWorld);
    state.camera.getWorldDirection(s.worldNormal).negate();
    s.hitPlane.setFromNormalAndCoplanarPoint(s.worldNormal, s.worldPoint);

    s.raycaster.setFromCamera(state.pointer, state.camera);
    const hit = s.raycaster.ray.intersectPlane(s.hitPlane, s.hitPoint);
    if (hit) {
      s.camRight.set(1, 0, 0).transformDirection(state.camera.matrixWorld);
      s.camUp.set(0, 1, 0).transformDirection(state.camera.matrixWorld);
      s.offset.copy(s.hitPoint).sub(s.worldPoint);
      const localX = s.offset.dot(s.camRight);
      const localY = s.offset.dot(s.camUp);
      group.getWorldScale(s.ndc);
      const halfW = (BOARD_W / 2) * Math.abs(s.ndc.x);
      const halfH = (BOARD_H / 2) * Math.abs(s.ndc.y);
      const onFace = Math.abs(localX) <= halfW && Math.abs(localY) <= halfH;
      hovering.current = onFace && !receded;
      if (onFace) {
        pointer.current.x = THREE.MathUtils.clamp(localX / halfW, -1, 1);
        pointer.current.y = THREE.MathUtils.clamp(localY / halfH, -1, 1);
      }
    } else {
      hovering.current = false;
    }

    const targetX = hovering.current ? pointer.current.x : 0;
    const targetY = hovering.current ? pointer.current.y : 0;
    aim.current.x = THREE.MathUtils.damp(aim.current.x, targetX, AIM_DAMP, step);
    aim.current.y = THREE.MathUtils.damp(aim.current.y, targetY, AIM_DAMP, step);

    const yaw = s.restEuler.y + aim.current.x * TILT_YAW;
    const pitch = s.restEuler.x - aim.current.y * TILT_PITCH;
    const roll = s.restEuler.z;

    if (!posed.current) {
      group.rotation.set(pitch, yaw, roll, "YXZ");
      posed.current = true;
    } else {
      group.rotation.order = "YXZ";
      group.rotation.y = THREE.MathUtils.damp(group.rotation.y, yaw, POSE_DAMP, step);
      group.rotation.x = THREE.MathUtils.damp(group.rotation.x, pitch, POSE_DAMP, step);
      group.rotation.z = THREE.MathUtils.damp(group.rotation.z, roll, POSE_DAMP, step);
    }

    group.position.x = THREE.MathUtils.damp(
      group.position.x,
      aim.current.x * DRIFT,
      POSE_DAMP,
      step,
    );
    group.position.y = THREE.MathUtils.damp(
      group.position.y,
      BOARD_Y + aim.current.y * DRIFT * 0.65,
      POSE_DAMP,
      step,
    );

    const faceOpacity = 1;
    if (faceMat.current) {
      faceMat.current.opacity = THREE.MathUtils.damp(
        faceMat.current.opacity,
        faceOpacity,
        6,
        step,
      );
      const faded = faceMat.current.opacity < 0.99;
      faceMat.current.transparent = true;
      faceMat.current.depthWrite = !faded;
    }

    for (let i = 0; i < itemRows.length; i += 1) {
      const mesh = chipRefs.current[i];
      const item = batch.items[itemRows[i].flatIndex];
      if (!mesh || !item) continue;
      const hot =
        itemRows[i].flatIndex === hoveredIndex ||
        itemRows[i].flatIndex === selectedIndex;
      mesh.position.z = THREE.MathUtils.damp(
        mesh.position.z,
        hot ? PUCK_Z + 0.09 : PUCK_Z,
        14,
        step,
      );
      mesh.scale.setScalar(
        THREE.MathUtils.damp(
          mesh.scale.x,
          hot ? (receded ? 1.16 : 1.22) : 1,
          14,
          step,
        ),
      );
      const material = mesh.material as THREE.Material & {
        emissiveIntensity?: number;
        opacity?: number;
        transparent?: boolean;
      };
      if (material.emissiveIntensity !== undefined) {
        material.emissiveIntensity = THREE.MathUtils.damp(
          material.emissiveIntensity,
          STATE_EMISSIVE[item.state] * (hot ? 2.4 : 1),
          10,
          step,
        );
      }
      if (material.opacity !== undefined) {
        material.transparent = true;
        material.opacity = THREE.MathUtils.damp(
          material.opacity,
          receded && !reduced ? (hot ? 1 : 0.92) : 1,
          6,
          step,
        );
      }
    }

    const selectedMesh =
      selectedIndex >= 0 ? chipRefs.current[selectedIndex] : null;
    if (selectedMesh) {
      selectedMesh.getWorldPosition(s.ndc);
      s.ndc.project(state.camera);
      const rect = gl.domElement.getBoundingClientRect();
      requirementAnchor.screenX = rect.left + (s.ndc.x * 0.5 + 0.5) * rect.width;
      requirementAnchor.screenY = rect.top + (-s.ndc.y * 0.5 + 0.5) * rect.height;
      requirementAnchor.valid = true;
    } else {
      requirementAnchor.valid = false;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh
        geometry={FACE_GEOMETRY}
        position={[0, 0, FACE_Z]}
        renderOrder={0}
        raycast={() => null}
      >
        <meshBasicMaterial
          ref={faceMat}
          map={texture}
          toneMapped={false}
          transparent
          alphaTest={0.2}
          depthWrite
          opacity={1}
        />
      </mesh>

      {itemRows.map((row) => {
        const item = batch.items[row.flatIndex];
        return (
          <RowHit
            key={`${item.slotId}-hit`}
            item={item}
            layout={layout}
            row={row}
          />
        );
      })}

      {itemRows.map((row, index) => {
        const item = batch.items[row.flatIndex];
        return (
          <StatusChip
            key={item.slotId}
            item={item}
            position={puckLocal(layout, row)}
            register={(mesh) => {
              chipRefs.current[index] = mesh;
            }}
          />
        );
      })}
    </group>
  );
}

/**
 * Requirement board for the selected submission batch. Batch switching lives in
 * the DOM submission chain, not on this mesh.
 */
export function SubmissionBoard({
  batches,
  focusedId,
}: {
  batches: SubmissionBatch[] | null;
  focusedId: string | null;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const snapped = useRef(false);
  const { camera, gl } = useThree();

  const focusedIndex = useMemo(() => {
    if (!batches) return 0;
    const index = batches.findIndex((batch) => batch.id === focusedId);
    return index >= 0 ? index : batches.length - 1;
  }, [batches, focusedId]);

  useFrame((_, delta) => {
    const root = rootRef.current;
    if (!root) return;
    const step = Math.min(delta, 0.1);
    const pose =
      batches && boardSlot.visible
        ? boardSlotPose(
            boardSlot,
            camera,
            gl.domElement.getBoundingClientRect(),
            SLOT_PLANE_Z,
            BOARD_W,
            BOARD_H,
          )
        : null;

    const targetScale = pose?.scale ?? 0.001;
    const targetX = pose?.x ?? 0;
    const targetY = pose?.y ?? 0;
    const targetZ = pose?.z ?? SLOT_PLANE_Z;

    if (pose && !snapped.current) {
      root.position.set(targetX, targetY, targetZ);
      root.scale.setScalar(targetScale);
      snapped.current = true;
    } else if (!pose) {
      snapped.current = false;
    }

    root.position.x = THREE.MathUtils.damp(root.position.x, targetX, 8, step);
    root.position.y = THREE.MathUtils.damp(root.position.y, targetY, 8, step);
    root.position.z = THREE.MathUtils.damp(root.position.z, targetZ, 8, step);
    root.scale.setScalar(
      THREE.MathUtils.damp(root.scale.x, targetScale, 8, step),
    );
    root.visible = root.scale.x > 0.02;
  });

  const focused = batches?.[focusedIndex] ?? null;

  return (
    <group ref={rootRef} scale={0.001}>
      {focused ? <RequirementBoard key={focused.id} batch={focused} /> : null}
    </group>
  );
}
