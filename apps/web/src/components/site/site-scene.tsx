"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import type { FlowKind, SiteLayout } from "@/lib/site-layouts";
import { labelPoint, objectTop, projector } from "./site-geometry";
import { SiteFlows } from "./site-flows";
import { SiteObjects } from "./site-objects";
import type { Subsurface, SubsurfaceView } from "./subsurface/model";
import { SubsurfaceScene } from "./subsurface/subsurface-scene";
import type { SensorReadings } from "./use-site-sensors";

const SKY = "#ECE7DD";
const CAMERA_START = new THREE.Vector3(-330, 380, 520);

// ---------------------------------------------------------------------------
// Terrain: flat where the site is, low rocky hills rising around it.

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 4; i += 1) {
    sum += amp * valueNoise(x * freq, y * freq);
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum;
}

const LOW = new THREE.Color("#CDBF9F");
const MID = new THREE.Color("#9C8466");
const HIGH = new THREE.Color("#5E4E3E");

function Terrain({ layout, ghost }: { layout: SiteLayout; ghost: boolean }) {
  const geometry = useMemo(() => {
    const p = projector(layout);
    const halfW = p.widthM / 2 + 25;
    const halfD = p.depthM / 2 + 25;
    const plane = new THREE.PlaneGeometry(1800, 1800, 120, 120);
    plane.rotateX(-Math.PI / 2);
    const position = plane.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const outside = Math.hypot(Math.max(0, Math.abs(x) - halfW), Math.max(0, Math.abs(z) - halfD));
      const rise = THREE.MathUtils.smoothstep(outside, 0, 260);
      const n = fbm(x / 170 + 11, z / 170 - 7);
      const y = rise * (14 + 120 * n * n) - 0.05;
      position.setY(i, y);
      const t = THREE.MathUtils.clamp(y / 70, 0, 1);
      color.copy(LOW).lerp(MID, Math.min(1, t * 2));
      if (t > 0.5) color.lerp(HIGH, (t - 0.5) * 2);
      colors.set([color.r, color.g, color.b], i * 3);
    }
    plane.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const faceted = plane.toNonIndexed();
    faceted.computeVertexNormals();
    plane.dispose();
    return faceted;
  }, [layout]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        vertexColors
        flatShading
        roughness={0.95}
        transparent={ghost}
        opacity={ghost ? 0.16 : 1}
        depthWrite={!ghost}
      />
    </mesh>
  );
}

function Pads({ layout, ghost }: { layout: SiteLayout; ghost: boolean }) {
  const p = useMemo(() => projector(layout), [layout]);
  const shapes = useMemo(
    () =>
      layout.pads.map((pad) => {
        const shape = new THREE.Shape(
          pad.points.map((px) => {
            const [x, z] = p.xz(px);
            return new THREE.Vector2(x, -z);
          }),
        );
        return { id: pad.id, color: pad.color, shape };
      }),
    [layout, p],
  );

  return (
    <>
      {shapes.map(({ id, color, shape }) => (
        <mesh key={id} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} receiveShadow>
          <shapeGeometry args={[shape]} />
          <meshStandardMaterial
            color={color}
            roughness={1}
            transparent={ghost}
            opacity={ghost ? 0.25 : 1}
            depthWrite={!ghost}
          />
        </mesh>
      ))}
    </>
  );
}

function Fence({ layout }: { layout: SiteLayout }) {
  const points = useMemo(() => {
    if (!layout.fence) return null;
    const p = projector(layout);
    return layout.fence.map((px) => {
      const [x, z] = p.xz(px);
      return new THREE.Vector3(x, 1.6, z);
    });
  }, [layout]);
  if (!points) return null;
  return <Line points={points} color="#3d3a33" lineWidth={1.2} />;
}

// ---------------------------------------------------------------------------
// Camera: fly in on open, swing out to a side view for the subsurface, and
// glide the orbit target to whatever is selected.

type Controls = {
  target: THREE.Vector3;
  update: () => void;
  enabled: boolean;
};

type ViewName = "surface" | "deep";
type CameraView = { position: THREE.Vector3; target: THREE.Vector3 };

const SURFACE_VIEW: CameraView = {
  position: new THREE.Vector3(-118, 96, 132),
  target: new THREE.Vector3(4, 0, 6),
};

/** Side view of the whole subsurface block, from the front-left and above. */
function deepView(sub: Subsurface | null): CameraView {
  if (!sub) {
    return { position: new THREE.Vector3(-420, 150, 540), target: new THREE.Vector3(0, -170, 0) };
  }
  const { frame, model } = sub;
  // Aim below the block's middle so it sits above the timeline at the bottom.
  const target = new THREE.Vector3(frame.centre.x, -model.block.bottom * 0.6, frame.centre.z);
  const size = Math.max(model.block.length, model.block.bottom);
  return {
    target,
    position: target.clone().add(new THREE.Vector3(-0.8 * size, 0.62 * size, 1.45 * size)),
  };
}

type Move = { from: THREE.Vector3; fromTarget: THREE.Vector3; t: number };

/** A view pulled back for narrow panels so the whole site stays in frame. */
function framed(views: Record<ViewName, CameraView>, view: ViewName, aspect: number, compact: boolean) {
  const { position, target } = views[view];
  const fit = aspect < 1.4 ? Math.pow(1.4 / aspect, 0.85) : 1;
  const offset = position.clone().sub(target).multiplyScalar(fit * (compact ? 1.15 : 1));
  return { target, position: target.clone().add(offset) };
}

function CameraRig({
  focus,
  view,
  views,
  compact,
}: {
  focus: THREE.Vector3 | null;
  view: ViewName;
  views: Record<ViewName, CameraView>;
  compact: boolean;
}) {
  const pending = useRef(true);
  const move = useRef<Move | null>(null);
  const focusAge = useRef(Infinity);

  useEffect(() => {
    pending.current = true;
  }, [view, compact]);

  useEffect(() => {
    focusAge.current = 0;
  }, [focus]);

  useFrame((state, delta) => {
    const controls = state.controls as unknown as Controls | null;
    const camera = state.camera;
    if (!controls) return;
    const dt = Math.min(delta, 0.1);

    if (pending.current) {
      pending.current = false;
      move.current = { from: camera.position.clone(), fromTarget: controls.target.clone(), t: 0 };
    }

    const current = move.current;
    if (current) {
      // Recomputed every frame so the framing follows the panel while it resizes.
      const frame = framed(views, view, state.size.width / Math.max(1, state.size.height), compact);
      current.t = Math.min(1, current.t + dt / 1.7);
      const e = 1 - Math.pow(1 - current.t, 3);
      camera.position.lerpVectors(current.from, frame.position, e);
      controls.target.lerpVectors(current.fromTarget, frame.target, e);
      controls.enabled = current.t >= 1;
      if (current.t >= 1) move.current = null;
    } else if (focus && focusAge.current < 1.4) {
      focusAge.current += dt;
      controls.target.lerp(focus, 1 - Math.exp(-dt * 4));
    }
    controls.update();
  });

  return null;
}

// ---------------------------------------------------------------------------

export type SiteSceneProps = {
  layout: SiteLayout;
  readings: SensorReadings;
  selectedId: string | null;
  hoveredId: string | null;
  subsurface: boolean;
  /** Subsurface model placed under the plan, and what it currently shows. */
  sub: Subsurface | null;
  subsurfaceView: SubsurfaceView | null;
  flows: Record<FlowKind, boolean>;
  /** Preview column: no labels, surface view only, slow orbit. */
  compact: boolean;
  /** Stop rendering while hidden behind another full-screen panel. */
  paused?: boolean;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  onSelectFracture: (index: number | null) => void;
};

export function SiteScene(props: SiteSceneProps) {
  const { layout, selectedId, compact, sub, subsurfaceView } = props;
  const subsurface = props.subsurface && !compact;
  const views = useMemo(() => ({ surface: SURFACE_VIEW, deep: deepView(sub) }), [sub]);

  const focus = useMemo(() => {
    // Below ground the camera keeps framing the whole block.
    if (subsurface) return null;
    const object = layout.objects.find((entry) => entry.id === selectedId);
    if (!object) return null;
    const [x, z] = projector(layout).xz(labelPoint(object));
    return new THREE.Vector3(x, objectTop(object) / 2, z);
  }, [layout, selectedId, subsurface]);

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      frameloop={props.paused ? "never" : "always"}
      camera={{ position: CAMERA_START.toArray(), fov: 40, near: 1, far: 8000 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onPointerMissed={() => {
        props.onSelect(null);
        props.onSelectFracture(null);
      }}
    >
      <color attach="background" args={[SKY]} />
      <fog attach="fog" args={[SKY, subsurface ? 2200 : 420, subsurface ? 4200 : 1100]} />

      <hemisphereLight intensity={0.85} color="#fffaf0" groundColor="#b8a988" />
      <directionalLight
        position={[140, 220, 90]}
        intensity={1.9}
        color="#fff3e2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-170}
        shadow-camera-right={170}
        shadow-camera-top={170}
        shadow-camera-bottom={-170}
        shadow-camera-near={10}
        shadow-camera-far={600}
        shadow-bias={-0.0004}
      />

      <Terrain layout={layout} ghost={subsurface} />
      <Pads layout={layout} ghost={subsurface} />
      <Fence layout={layout} />
      {subsurface && sub && subsurfaceView ? (
        <SubsurfaceScene
          sub={sub}
          view={subsurfaceView}
          selectedId={selectedId}
          onSelect={props.onSelect}
          onSelectFracture={props.onSelectFracture}
        />
      ) : null}

      <SiteObjects
        layout={layout}
        readings={props.readings}
        selectedId={selectedId}
        hoveredId={props.hoveredId}
        labels={!compact}
        subsurface={subsurface}
        onSelect={props.onSelect}
        onHover={props.onHover}
      />
      <SiteFlows layout={layout} visible={props.flows} subsurface={subsurface} compact={compact} />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={30}
        maxDistance={subsurface ? 3200 : 900}
        maxPolarAngle={subsurface ? Math.PI * 0.8 : Math.PI * 0.46}
        autoRotate={compact}
        autoRotateSpeed={0.5}
        screenSpacePanning
      />
      <CameraRig focus={focus} view={subsurface ? "deep" : "surface"} views={views} compact={compact} />
    </Canvas>
  );
}
