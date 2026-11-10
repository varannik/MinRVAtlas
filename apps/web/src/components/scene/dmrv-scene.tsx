"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GlobeCluster } from "./globe-cluster";
import { SubmissionBoard } from "./submission-board";
import { BRAND } from "@/lib/brand";
import { getSubmissions } from "@/lib/submissions";
import { overlayBatches } from "@/lib/sentinel/overlay";
import { periodsFor, usePeriodStore } from "@/store/period-store";
import { useRegistrySubmit } from "@/store/registry-submit-store";
import { useResolvedProject } from "@/hooks/use-visible-projects";
import { useStageMode } from "@/hooks/use-stage-mode";
import { useDashboard } from "@/store/dashboard-store";
import { useStage } from "@/store/stage-store";
import { usePipeline } from "@/store/pipeline-store";

/** Dims the world map without touching the board, which sits in front of it. */
function BackdropScrim({
  active,
  deep,
}: {
  active: boolean;
  deep: boolean;
}) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    const mesh = ref.current;
    if (!mesh) return;
    const material = mesh.material as THREE.MeshBasicMaterial;
    material.opacity = THREE.MathUtils.damp(
      material.opacity,
      active ? (deep ? 0.88 : 0.72) : 0,
      3.5,
      Math.min(delta, 0.1),
    );
    mesh.visible = material.opacity > 0.01;
  });

  return (
    <mesh ref={ref} position={[0, 0, -1]} raycast={() => null}>
      <planeGeometry args={[80, 60]} />
      <meshBasicMaterial
        color={BRAND.offWhite}
        transparent
        opacity={0}
        depthWrite={false}
      />
    </mesh>
  );
}

export function DmrvScene() {
  const selectedProjectId = useDashboard((state) => state.selectedProjectId);
  const selectedSubmissionId = useDashboard(
    (state) => state.selectedSubmissionId,
  );
  const specProjectId = useDashboard((state) => state.specProjectId);
  const requirementSpec = useDashboard((state) => state.requirementSpec);
  const pipelineByKey = usePipeline((state) => state.byKey);
  const submitByKey = useRegistrySubmit((state) => state.byKey);
  const periodMap = usePeriodStore((state) => state.byProject);
  const selected = useResolvedProject(selectedProjectId);
  // The full-screen 3D chain covers the globe; stop drawing it meanwhile.
  const siteOpen = useDashboard((state) => state.siteOpen);
  // On the stage the globe is the centrepiece, so nothing dims it.
  const stage = useStageMode();
  // The ledger page and calculation tree cover the stage completely.
  const pageOpen = useStage((state) => state.ledgerOpen || Boolean(state.calc));
  const covered = stage && pageOpen;

  const spec =
    selected && specProjectId === selected.id ? requirementSpec : null;

  const batches = useMemo(() => {
    if (!selected) return null;
    const periods = periodMap[selected.id] ?? periodsFor(selected.id);
    return overlayBatches(
      getSubmissions(selected, spec ?? undefined, periods),
      pipelineByKey,
      submitByKey,
    );
  }, [periodMap, pipelineByKey, selected, spec, submitByKey]);

  return (
    <Canvas
      frameloop={siteOpen || covered ? "never" : "always"}
      camera={{ position: [0, 0.35, 6.2], fov: 45 }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <color attach="background" args={[BRAND.offWhite]} />

      <hemisphereLight
        intensity={0.9}
        groundColor={BRAND.sand}
        color="#f7f3ec"
      />
      <ambientLight intensity={0.95} />
      <directionalLight position={[5, 4, 6]} intensity={1.35} color="#fff8f0" />
      <directionalLight
        position={[-6, -2, -4]}
        intensity={0.4}
        color={BRAND.calcite}
      />

      <GlobeCluster />
      <BackdropScrim active={Boolean(selected) && !stage} deep={false} />
      <SubmissionBoard batches={batches} focusedId={selectedSubmissionId} />
    </Canvas>
  );
}
