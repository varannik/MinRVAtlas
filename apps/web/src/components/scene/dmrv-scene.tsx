"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GlobeCluster } from "./globe-cluster";
import { KpiTiles } from "./kpi-tiles";
import { SubmissionBoard } from "./submission-board";
import type { TileContent } from "./panel-texture";
import { BRAND, FILL } from "@/lib/brand";
import { formatCompact } from "@/lib/format";
import { getSubmissions } from "@/lib/submissions";
import { overlayBatches } from "@/lib/sentinel/overlay";
import {
  useResolvedProject,
  useVisibleProjects,
} from "@/hooks/use-visible-projects";
import { useDashboard } from "@/store/dashboard-store";
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
  const projects = useVisibleProjects();
  const selectedProjectId = useDashboard((state) => state.selectedProjectId);
  const selectedSubmissionId = useDashboard(
    (state) => state.selectedSubmissionId,
  );
  const specProjectId = useDashboard((state) => state.specProjectId);
  const requirementSpec = useDashboard((state) => state.requirementSpec);
  const pipelineByKey = usePipeline((state) => state.byKey);
  const selected = useResolvedProject(selectedProjectId);

  const spec =
    selected && specProjectId === selected.id ? requirementSpec : null;

  const batches = useMemo(() => {
    if (!selected) return null;
    return overlayBatches(
      getSubmissions(selected, spec ?? undefined),
      pipelineByKey,
    );
  }, [pipelineByKey, selected, spec]);

  const tiles = useMemo<TileContent[]>(() => {
    const issued = projects.reduce((sum, p) => sum + p.creditsIssued, 0);
    const forecast = projects.reduce((sum, p) => sum + p.annualForecast, 0);
    const sensors = projects.reduce((sum, p) => sum + p.sensors, 0);
    const openBatches = projects.reduce((sum, p) => {
      const chain = getSubmissions(p);
      return sum + chain.filter((batch) => batch.status !== "issued").length;
    }, 0);

    return [
      {
        label: "Credits issued to date",
        value: formatCompact(issued),
        unit: "tCO₂e",
        accent: FILL.complete,
      },
      {
        label: "Forecast annual removals",
        value: formatCompact(forecast),
        unit: "tCO₂e / yr",
        accent: BRAND.serpentine,
      },
      {
        label: "Live sensor streams",
        value: formatCompact(sensors),
        unit: "devices",
        accent: BRAND.sand,
      },
      {
        label: "Batches in flight",
        value: `${openBatches}`,
        unit: "submissions",
        accent: BRAND.canyon,
      },
    ];
  }, [projects]);

  return (
    <Canvas
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
      <BackdropScrim active={Boolean(selected)} deep={false} />
      <SubmissionBoard batches={batches} focusedId={selectedSubmissionId} />
      <KpiTiles tiles={tiles} visible={!selected} />
    </Canvas>
  );
}
