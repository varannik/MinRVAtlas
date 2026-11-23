"use client";

import { Canvas } from "@react-three/fiber";
import { GlobeCluster } from "./globe-cluster";
import { BRAND } from "@/lib/brand";
import { useDashboard } from "@/store/dashboard-store";

/**
 * The Atlas globe with every project's pin. An open project's live chain
 * covers the whole screen, so the globe stops drawing until it closes.
 */
export function DmrvScene() {
  const covered = useDashboard((state) => Boolean(state.selectedProjectId));

  return (
    <Canvas
      frameloop={covered ? "never" : "always"}
      camera={{ position: [0, 0.35, 6.2], fov: 45 }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      {/* No scene background: the Calcite veil behind the canvas shows through the glass. */}
      <hemisphereLight intensity={0.9} groundColor={BRAND.sand} color="#f7f3ec" />
      <ambientLight intensity={0.95} />
      <directionalLight position={[5, 4, 6]} intensity={1.35} color="#fff8f0" />
      <directionalLight position={[-6, -2, -4]} intensity={0.4} color={BRAND.calcite} />

      <GlobeCluster />
    </Canvas>
  );
}
