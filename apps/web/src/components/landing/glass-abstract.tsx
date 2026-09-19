"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment } from "@react-three/drei";
import { Application } from "@splinetool/runtime";
import * as THREE from "three";
import { scheduleEffect } from "@/lib/schedule-effect";

const SCENE_URLS = [
  "/scenes/glass-abstract.splinecode",
  "/scenes/glass-abstract.spline",
];

function GlassPlate() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    const mesh = ref.current;
    if (!mesh) return;
    mesh.rotation.y += Math.min(delta, 0.05) * 0.18;
  });

  return (
    <mesh ref={ref} rotation={[-0.42, 0.55, 0.08]}>
      <boxGeometry args={[2.35, 2.35, 0.28]} />
      <meshPhysicalMaterial
        color="#c8cdb8"
        transmission={0.88}
        thickness={1.1}
        roughness={0.12}
        ior={1.5}
        attenuationColor="#8B9C44"
        attenuationDistance={1.8}
        metalness={0.05}
        reflectivity={0.55}
      />
    </mesh>
  );
}

function FallbackScene() {
  return (
    <Canvas
      camera={{ position: [0, 0.15, 4.1], fov: 38 }}
      dpr={[1, 1.6]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      style={{ width: "100%", height: "100%" }}
    >
      <color attach="background" args={["#0b0b0f"]} />
      <ambientLight intensity={0.45} color="#e8e4d8" />
      <directionalLight position={[4.2, 5.4, 3.8]} intensity={2.1} color="#fff7ee" />
      <directionalLight position={[-3.6, 1.2, -1.4]} intensity={0.45} color="#beb290" />
      <GlassPlate />
      <ContactShadows
        position={[0, -1.45, 0]}
        opacity={0.5}
        scale={12}
        blur={2.4}
        far={4}
        color="#070808"
      />
      <Environment preset="city" environmentIntensity={0.55} />
    </Canvas>
  );
}

export function GlassAbstract() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<"spline" | "fallback">("spline");

  useEffect(() => {
    if (mode !== "spline") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let app: Application | null = null;
    let disposed = false;

    const stop = scheduleEffect(async () => {
      try {
        app = new Application(canvas);
        let loaded = false;
        for (const url of SCENE_URLS) {
          try {
            await Promise.race([
              app.load(url),
              new Promise((_, reject) => {
                setTimeout(() => reject(new Error("timeout")), 2500);
              }),
            ]);
            loaded = true;
            break;
          } catch {
            // try the next candidate
          }
        }
        if (!loaded || disposed) {
          throw new Error("Spline scene is not available");
        }
      } catch {
        app?.dispose();
        app = null;
        if (!disposed) setMode("fallback");
      }
    });

    return () => {
      disposed = true;
      stop();
      app?.dispose();
    };
  }, [mode]);

  if (mode === "fallback") {
    return <FallbackScene />;
  }

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 block h-full w-full"
      aria-hidden
    />
  );
}
