"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { KeyRound } from "lucide-react";
import * as THREE from "three";
import { SUBMISSION_STATUS_META } from "@/lib/submissions";
import { useDashboard } from "@/store/dashboard-store";
import { dragState } from "./drag-state";
import { panelAnchor, requirementAnchor } from "./requirement-anchor";
import {
  chainFocusX,
  chainWorkspaceX,
  WORKSPACE_BOARD_SCALE,
  WORKSPACE_BOARD_Z,
  WORKSPACE_OVERLAP_PX,
} from "./layout";
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

const BOARD_Y = -0.5;
const BOARD_Z = 0.4;
const RIBBON_Y = 1.66;
const RIBBON_STEP = 1.16;
const NODE_W = 0.66;
const NODE_H = 0.4;

const DOT_COUNT = 7;
const DOT_GEOMETRY = new THREE.PlaneGeometry(0.05, 0.048);

const SLAB_GEOMETRY = new THREE.BoxGeometry(BOARD_W, BOARD_H, BOARD_D);
const SLAB_EDGES = new THREE.EdgesGeometry(SLAB_GEOMETRY);
const FACE_GEOMETRY = new THREE.PlaneGeometry(BOARD_W, BOARD_H);
const PUCK_GEOMETRY = new THREE.BoxGeometry(PUCK_SIZE, PUCK_SIZE, PUCK_DEPTH);
const NODE_GEOMETRY = new THREE.BoxGeometry(NODE_W, NODE_H, 0.08);
const NODE_EDGES = new THREE.EdgesGeometry(NODE_GEOMETRY);

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
        <meshBasicMaterial color="#3f6389" wireframe transparent opacity={0.9} />
      ) : (
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={STATE_EMISSIVE[item.state]}
          metalness={0.25}
          roughness={0.34}
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
  const slabMat = useRef<THREE.MeshStandardMaterial>(null);
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
    const basis = parent ?? group;
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

    s.worldPoint.set(0, BOARD_Y, BOARD_Z + FACE_Z).applyMatrix4(basis.matrixWorld);
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
      const onFace =
        Math.abs(localX) <= BOARD_W / 2 && Math.abs(localY) <= BOARD_H / 2;
      hovering.current = onFace && !receded;
      if (onFace) {
        pointer.current.x = THREE.MathUtils.clamp(localX / (BOARD_W / 2), -1, 1);
        pointer.current.y = THREE.MathUtils.clamp(localY / (BOARD_H / 2), -1, 1);
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

    const faceOpacity = receded && !reduced ? 0.34 : 1;
    const slabOpacity = receded && !reduced ? 0.38 : 1;
    if (faceMat.current) {
      faceMat.current.opacity = THREE.MathUtils.damp(
        faceMat.current.opacity,
        faceOpacity,
        6,
        step,
      );
      const faded = faceMat.current.opacity < 0.99;
      faceMat.current.transparent = faded;
      faceMat.current.depthWrite = !faded;
    }
    if (slabMat.current) {
      slabMat.current.opacity = THREE.MathUtils.damp(
        slabMat.current.opacity,
        slabOpacity,
        6,
        step,
      );
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
          receded && !reduced ? (hot ? 0.72 : 0.32) : 1,
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
    <group ref={groupRef} position={[0, BOARD_Y, BOARD_Z]}>
      <mesh geometry={SLAB_GEOMETRY} raycast={() => null}>
        <meshStandardMaterial
          ref={slabMat}
          color="#04101d"
          metalness={0.35}
          roughness={0.62}
          transparent
          opacity={1}
        />
      </mesh>

      <lineSegments geometry={SLAB_EDGES} raycast={() => null}>
        <lineBasicMaterial
          color={SUBMISSION_STATUS_META[batch.status].color}
          transparent
          opacity={0.45}
        />
      </lineSegments>

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
          transparent={false}
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

function RibbonNode({
  batch,
  x,
  active,
}: {
  batch: SubmissionBatch;
  x: number;
  active: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const selectSubmission = useDashboard((state) => state.selectSubmission);
  const status = SUBMISSION_STATUS_META[batch.status];

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    group.scale.setScalar(
      THREE.MathUtils.damp(group.scale.x, active ? 1 : 0.86, 6, Math.min(delta, 0.1)),
    );
  });

  return (
    <group ref={groupRef} position={[x, 0, active ? 0.06 : 0]}>
      <mesh
        geometry={NODE_GEOMETRY}
        onClick={(event) => {
          event.stopPropagation();
          if (dragState.moved) return;
          selectSubmission(batch.id);
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "auto";
        }}
      >
        <meshStandardMaterial
          color={active ? "#0b1c30" : "#07131f"}
          metalness={0.3}
          roughness={0.6}
        />
      </mesh>

      <lineSegments geometry={NODE_EDGES} raycast={() => null}>
        <lineBasicMaterial
          color={status.color}
          transparent
          opacity={active ? 0.85 : 0.35}
        />
      </lineSegments>

      <mesh position={[0, -NODE_H / 2 + 0.06, 0.05]} raycast={() => null}>
        <planeGeometry args={[NODE_W - 0.12, 0.035]} />
        <meshBasicMaterial color="#12253c" toneMapped={false} />
      </mesh>
      <mesh
        position={[
          -(NODE_W - 0.12) / 2 + ((NODE_W - 0.12) * batch.completion) / 200,
          -NODE_H / 2 + 0.06,
          0.052,
        ]}
        raycast={() => null}
      >
        <planeGeometry args={[((NODE_W - 0.12) * batch.completion) / 100, 0.035]} />
        <meshBasicMaterial color={status.color} toneMapped={false} />
      </mesh>

      <Html position={[0, 0.05, 0.06]} center style={{ pointerEvents: "none" }}>
        <div
          className={`w-28 text-center transition-opacity duration-200 ${
            active ? "opacity-100" : "opacity-65"
          }`}
        >
          <div className="font-mono text-[10px] font-semibold text-frost">
            B{batch.sequence}
          </div>
          <div
            className="text-[9px] font-medium"
            style={{ color: status.color }}
          >
            {status.label} · {batch.completion}%
          </div>
        </div>
      </Html>
    </group>
  );
}

/**
 * A dotted link carrying the key that seals one batch to the next: the child
 * batch stores this hash as its parent, so a monitoring period cannot be
 * re-credited or edited after the fact without breaking the chain.
 */
function RibbonLink({
  x,
  hash,
  lit,
}: {
  x: number;
  hash: string;
  lit: boolean;
}) {
  const length = RIBBON_STEP - NODE_W;
  const gap = length / (DOT_COUNT - 1);

  return (
    <group position={[x, 0, -0.02]}>
      {Array.from({ length: DOT_COUNT }, (_, index) => (
        <mesh
          key={index}
          geometry={DOT_GEOMETRY}
          position={[-length / 2 + index * gap, 0, 0]}
          raycast={() => null}
        >
          <meshBasicMaterial
            color={lit ? "#5ce1e6" : "#2f5b86"}
            transparent
            opacity={lit ? 0.95 : 0.7}
            toneMapped={false}
          />
        </mesh>
      ))}

      <Html position={[0, 0.15, 0.05]} center style={{ pointerEvents: "none" }}>
        <div
          className={`flex items-center gap-1 rounded-md bg-ink-900/85 px-1.5 py-0.5 ring-1 transition-colors ${
            lit ? "ring-cyan/45" : "ring-line/70"
          }`}
        >
          <KeyRound
            className={`size-2.5 shrink-0 ${lit ? "text-cyan" : "text-mist"}`}
          />
          <span className="font-mono text-[8px] leading-none text-mist">
            {hash.slice(0, 8)}
          </span>
        </div>
      </Html>
    </group>
  );
}

/**
 * The chain of submission batches for one project: a hash-linked ribbon of
 * batches on top, and the requirement board for the selected batch below it.
 */
export function SubmissionBoard({
  batches,
  focusedId,
}: {
  batches: SubmissionBatch[] | null;
  focusedId: string | null;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const edgeRef = useRef(new THREE.Vector3());
  const { viewport, size, camera, gl } = useThree();
  const selectedSlotId = useDashboard((state) => state.selectedSlotId);

  const focusedIndex = useMemo(() => {
    if (!batches) return 0;
    const index = batches.findIndex((batch) => batch.id === focusedId);
    return index >= 0 ? index : batches.length - 1;
  }, [batches, focusedId]);

  const ribbonOffset = batches ? ((batches.length - 1) * RIBBON_STEP) / 2 : 0;

  useFrame((_, delta) => {
    const root = rootRef.current;
    if (!root) return;
    const step = Math.min(delta, 0.1);
    const visible = Boolean(batches);
    const receded = Boolean(selectedSlotId);
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wide = size.width >= 1024;
    const targetScale = visible
      ? receded && !reduced && wide
        ? WORKSPACE_BOARD_SCALE
        : receded && !wide
          ? 0.9
          : 1
      : 0.001;

    let targetX = receded
      ? chainWorkspaceX(viewport)
      : chainFocusX(viewport, true);
    const targetY = 0;
    if (receded && wide && panelAnchor.visible) {
      const factor = Math.max(viewport.factor, 1e-3);
      const edge = edgeRef.current;
      edge.set(BOARD_W / 2, 0, 0);
      edge.applyMatrix4(root.matrixWorld);
      edge.project(camera);
      const rect = gl.domElement.getBoundingClientRect();
      const currentRight = rect.left + (edge.x * 0.5 + 0.5) * rect.width;
      const desiredRight = panelAnchor.screenX + WORKSPACE_OVERLAP_PX;
      targetX = root.position.x + (desiredRight - currentRight) / factor;
    }

    const posDamp = receded ? 10 : 5;
    const scaleDamp = receded ? 8 : 6;
    root.position.x = THREE.MathUtils.damp(root.position.x, targetX, posDamp, step);
    root.position.y = THREE.MathUtils.damp(root.position.y, targetY, posDamp, step);
    root.position.z = THREE.MathUtils.damp(
      root.position.z,
      receded && !reduced ? WORKSPACE_BOARD_Z : 0,
      posDamp,
      step,
    );
    root.scale.setScalar(
      THREE.MathUtils.damp(root.scale.x, targetScale, scaleDamp, step),
    );
    root.visible = root.scale.x > 0.02;
  });

  const focused = batches?.[focusedIndex] ?? null;

  return (
    <group ref={rootRef} scale={0.001}>
      {focused ? <RequirementBoard key={focused.id} batch={focused} /> : null}

      {selectedSlotId ? null : (
        <group position={[0, RIBBON_Y, 0]}>
          {batches?.map((batch, index) => (
            <RibbonNode
              key={batch.id}
              batch={batch}
              x={index * RIBBON_STEP - ribbonOffset}
              active={index === focusedIndex}
            />
          ))}
          {batches?.slice(0, -1).map((batch, index) => (
            <RibbonLink
              key={`${batch.id}-link`}
              x={(index + 0.5) * RIBBON_STEP - ribbonOffset}
              hash={batch.hash}
              lit={index === focusedIndex || index + 1 === focusedIndex}
            />
          ))}
        </group>
      )}
    </group>
  );
}
