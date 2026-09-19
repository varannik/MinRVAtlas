"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment } from "@react-three/drei";
import { Application } from "@splinetool/runtime";
import * as THREE from "three";
import { scheduleEffect } from "@/lib/schedule-effect";

const SCENE_URL = "/scenes/glass-abstract.spline";
const VIEW_MS = 1400;

type Vec3 = {
  x: number;
  y: number;
  z: number;
  set: (x: number, y: number, z: number) => void;
};

type SplineCamera = {
  lookAt: (x: number, y: number, z: number) => void;
  position: Vec3;
  rotation: Vec3;
  quaternion?: {
    x: number;
    y: number;
    z: number;
    w: number;
    set: (x: number, y: number, z: number, w: number) => void;
  };
  updateMatrixWorld?: (force?: boolean) => void;
  zoom?: number;
};

type SplineMesh = {
  name: string;
  position: Vec3;
};

type SplinePage = {
  bgColor?: { a: number };
  activeCamera?: SplineCamera;
  children?: SplineMesh[];
};

type SplineInternals = {
  _scene?: { activePage?: SplinePage };
  _renderer?: {
    setClearAlpha?: (alpha: number) => void;
    setClearColor?: (color: number, alpha: number) => void;
  };
};

type CameraPose = {
  position: [number, number, number];
  rotation: [number, number, number];
  quaternion: [number, number, number, number] | null;
  zoom: number;
};

function pageOf(app: Application): SplinePage | undefined {
  return (app as unknown as SplineInternals)._scene?.activePage;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function easeView(t: number) {
  return 1 - (1 - t) ** 4;
}

function slerpQuat(
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number,
): [number, number, number, number] {
  let [bx, by, bz, bw] = b;
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    dot = -dot;
  }
  if (dot > 0.9995) {
    const x = lerp(a[0], bx, t);
    const y = lerp(a[1], by, t);
    const z = lerp(a[2], bz, t);
    const w = lerp(a[3], bw, t);
    const n = Math.hypot(x, y, z, w) || 1;
    return [x / n, y / n, z / n, w / n];
  }
  const theta0 = Math.acos(Math.min(1, dot));
  const theta = theta0 * t;
  const s0 = Math.sin(theta0 - theta) / Math.sin(theta0);
  const s1 = Math.sin(theta) / Math.sin(theta0);
  return [s0 * a[0] + s1 * bx, s0 * a[1] + s1 * by, s0 * a[2] + s1 * bz, s0 * a[3] + s1 * bw];
}

function snapshotCamera(camera: SplineCamera): CameraPose {
  return {
    position: [camera.position.x, camera.position.y, camera.position.z],
    rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z],
    quaternion: camera.quaternion
      ? [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w]
      : null,
    zoom: camera.zoom ?? 1,
  };
}

function applyPose(app: Application, camera: SplineCamera, pose: CameraPose) {
  camera.position.set(...pose.position);
  if (pose.quaternion && camera.quaternion) {
    camera.quaternion.set(...pose.quaternion);
  } else {
    camera.rotation.set(...pose.rotation);
  }
  camera.updateMatrixWorld?.(true);
  app.setZoom(pose.zoom);
}

function makeSplinePageTransparent(app: Application) {
  app.setBackgroundColor("#000000");
  const intern = app as unknown as SplineInternals;
  const page = intern._scene?.activePage;
  if (page?.bgColor) page.bgColor.a = 0;
  intern._renderer?.setClearAlpha?.(0);
  intern._renderer?.setClearColor?.(0x000000, 0);
}

function centeredPose(app: Application): CameraPose | null {
  const page = pageOf(app);
  const camera = page?.activeCamera;
  const mesh = page?.children?.find((child) => child.name === "Shape");
  if (!camera || !mesh) return null;
  const start = snapshotCamera(camera);
  const toward = 0.78;
  camera.position.set(
    lerp(mesh.position.x, camera.position.x, toward),
    lerp(mesh.position.y, camera.position.y, toward),
    lerp(mesh.position.z, camera.position.z, toward),
  );
  camera.lookAt(mesh.position.x, mesh.position.y, mesh.position.z);
  camera.updateMatrixWorld?.(true);
  app.setZoom(Math.max(start.zoom, 1) * 1.12);
  const target = snapshotCamera(camera);
  applyPose(app, camera, start);
  return target;
}

function tweenPose(
  app: Application,
  from: CameraPose,
  to: CameraPose,
  duration: number,
): () => void {
  const camera = pageOf(app)?.activeCamera;
  if (!camera) return () => {};
  let raf = 0;
  let cancelled = false;
  const started = performance.now();
  const tick = (now: number) => {
    if (cancelled) return;
    const t = Math.min(1, (now - started) / duration);
    const e = easeView(t);
    camera.position.set(
      lerp(from.position[0], to.position[0], e),
      lerp(from.position[1], to.position[1], e),
      lerp(from.position[2], to.position[2], e),
    );
    if (from.quaternion && to.quaternion && camera.quaternion) {
      camera.quaternion.set(...slerpQuat(from.quaternion, to.quaternion, e));
    } else {
      camera.rotation.set(
        lerp(from.rotation[0], to.rotation[0], e),
        lerp(from.rotation[1], to.rotation[1], e),
        lerp(from.rotation[2], to.rotation[2], e),
      );
    }
    camera.updateMatrixWorld?.(true);
    app.setZoom(lerp(from.zoom, to.zoom, e));
    app.requestRender();
    if (t < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}

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

const FALLBACK_REST = new THREE.Vector3(0.55, -0.12, 0);
const FALLBACK_FOCUS = new THREE.Vector3(0, 0.05, 0);

function LerpGroup({
  centered,
  instant,
  children,
}: {
  centered: boolean;
  instant: boolean;
  children: ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const group = ref.current;
    if (!group) return;
    const target = centered ? FALLBACK_FOCUS : FALLBACK_REST;
    if (instant) {
      group.position.copy(target);
      return;
    }
    const k = 1 - Math.exp(-3.2 * delta);
    group.position.lerp(target, k);
  });

  return <group ref={ref}>{children}</group>;
}

function FallbackScene({
  centered,
  instant,
}: {
  centered: boolean;
  instant: boolean;
}) {
  return (
    <Canvas
      camera={{ position: [0, 0.15, 4.1], fov: 38 }}
      dpr={[1, 1.6]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ width: "100%", height: "100%", background: "transparent" }}
    >
      <ambientLight intensity={0.45} color="#e8e4d8" />
      <directionalLight position={[4.2, 5.4, 3.8]} intensity={2.1} color="#fff7ee" />
      <directionalLight position={[-3.6, 1.2, -1.4]} intensity={0.45} color="#beb290" />
      <LerpGroup centered={centered} instant={instant}>
        <GlassPlate />
      </LerpGroup>
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

export function GlassAbstract({
  centered = false,
  instant = false,
}: {
  centered?: boolean;
  instant?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<Application | null>(null);
  const homeRef = useRef<CameraPose | null>(null);
  const focusRef = useRef<CameraPose | null>(null);
  const centeredRef = useRef(centered);
  const instantRef = useRef(instant);
  const stopTween = useRef<(() => void) | null>(null);
  const [mode, setMode] = useState<"spline" | "fallback">("spline");

  useEffect(() => {
    centeredRef.current = centered;
  }, [centered]);

  useEffect(() => {
    instantRef.current = instant;
  }, [instant]);

  useEffect(() => {
    if (mode !== "spline") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let app: Application | null = null;
    let disposed = false;

    const stop = scheduleEffect(async () => {
      try {
        app = new Application(canvas, {
          renderMode: "continuous",
        });
        await app.load(SCENE_URL);
        if (disposed) return;
        makeSplinePageTransparent(app);
        const homeCamera = pageOf(app)?.activeCamera;
        if (!homeCamera) throw new Error("Spline camera is missing");
        homeRef.current = snapshotCamera(homeCamera);
        focusRef.current = centeredPose(app);
        appRef.current = app;
        if (centeredRef.current && focusRef.current && homeRef.current) {
          stopTween.current?.();
          if (instantRef.current) applyPose(app, homeCamera, focusRef.current);
          else {
            stopTween.current = tweenPose(
              app,
              homeRef.current,
              focusRef.current,
              VIEW_MS,
            );
          }
        }
      } catch (error) {
        console.error("Spline scene failed to load", error);
        app?.dispose();
        app = null;
        appRef.current = null;
        if (!disposed) setMode("fallback");
      }
    });

    return () => {
      disposed = true;
      stop();
      stopTween.current?.();
      stopTween.current = null;
      app?.dispose();
      appRef.current = null;
    };
  }, [mode]);

  useEffect(() => {
    const app = appRef.current;
    const home = homeRef.current;
    const focus = focusRef.current;
    const camera = app ? pageOf(app)?.activeCamera : undefined;
    if (!app || !home || !focus || !camera) return;
    stopTween.current?.();
    const from = snapshotCamera(camera);
    const to = centered ? focus : home;
    if (instant) {
      applyPose(app, camera, to);
      stopTween.current = null;
      return;
    }
    stopTween.current = tweenPose(app, from, to, VIEW_MS);
    return () => {
      stopTween.current?.();
      stopTween.current = null;
    };
  }, [centered, instant]);

  if (mode === "fallback") {
    return <FallbackScene centered={centered} instant={instant} />;
  }

  return <canvas ref={canvasRef} aria-hidden />;
}
