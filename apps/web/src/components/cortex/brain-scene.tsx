"use client";

import { useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Billboard, Html, Line } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";

import {
  CAPABILITIES,
  LOBE_BY_ID,
  pinDirection,
  type Capability,
} from "@/lib/cortex/capabilities";
import { useCortex } from "@/store/cortex-store";
import {
  CORE_FRAGMENT,
  CORE_VERTEX,
  DOT_FRAGMENT,
  DOT_VERTEX,
  HALO_FRAGMENT,
  HALO_VERTEX,
  LINE_FRAGMENT,
  LINE_VERTEX,
  buildFilaments,
} from "./brain-parts";

const CORE_RADIUS = 1;
const SHELL_RADIUS = 3;
const PIN_RADIUS = 2.55;
/** Pointer travel (px) above which a press counts as a drag, not a click. */
const DRAG_SLOP = 6;

type Control = {
  yaw: number;
  pitch: number;
  dragging: boolean;
  moved: number;
  reduced: boolean;
};

function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  return ((((angle + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
}

// ── Backdrop ────────────────────────────────────────────────────────────────

function Backdrop() {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const linear = ctx.createLinearGradient(0, 0, 1024, 1024);
    linear.addColorStop(0, "#6D5ACB");
    linear.addColorStop(0.55, "#8A76D9");
    linear.addColorStop(1, "#B78BD2");
    ctx.fillStyle = linear;
    ctx.fillRect(0, 0, 1024, 1024);
    const radial = ctx.createRadialGradient(512, 500, 30, 512, 500, 640);
    radial.addColorStop(0, "rgba(168, 154, 240, 0.6)");
    radial.addColorStop(1, "rgba(168, 154, 240, 0)");
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, 1024, 1024);

    const gradient = new THREE.CanvasTexture(canvas);
    gradient.colorSpace = THREE.SRGBColorSpace;
    return gradient;
  }, []);

  useEffect(() => () => texture?.dispose(), [texture]);

  if (!texture) return <color attach="background" args={["#7E6AD2"]} />;
  return <primitive attach="background" object={texture} />;
}

// ── Core ────────────────────────────────────────────────────────────────────

function Core() {
  const meshRef = useRef<THREE.Mesh>(null);
  const coreMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const haloMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const active = useCortex((state) => state.hovered === "core" || state.selected === "core");
  const select = useCortex((state) => state.select);
  const hover = useCortex((state) => state.hover);

  const coreUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uCellA: { value: new THREE.Color("#8F7DF7") },
      uCellB: { value: new THREE.Color("#C8BDFF") },
      uWall: { value: new THREE.Color("#23178F") },
      uRim: { value: new THREE.Color("#F2EDFF") },
    }),
    [],
  );

  const haloUniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color("#D9D0FF") },
      uStrength: { value: 0.3 },
    }),
    [],
  );

  useFrame((state, delta) => {
    const core = coreMaterialRef.current;
    const halo = haloMaterialRef.current;
    if (!core || !halo) return;
    const d = Math.min(delta, 0.1);
    core.uniforms.uTime.value = state.clock.elapsedTime;
    const pulse = THREE.MathUtils.damp(core.uniforms.uPulse.value, active ? 1 : 0, 4, d);
    core.uniforms.uPulse.value = pulse;
    halo.uniforms.uStrength.value = 0.3 + pulse * 0.3;
    const breathe = 1 + Math.sin(state.clock.elapsedTime * 1.1) * 0.012 + pulse * 0.035;
    meshRef.current?.scale.setScalar(breathe);
  });

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.delta > DRAG_SLOP) return;
    select("core");
  };

  return (
    <group>
      <mesh
        ref={meshRef}
        onClick={onClick}
        onPointerOver={(event) => {
          event.stopPropagation();
          hover("core");
        }}
        onPointerOut={() => hover(null)}
      >
        <sphereGeometry args={[CORE_RADIUS, 128, 128]} />
        <shaderMaterial
          ref={coreMaterialRef}
          vertexShader={CORE_VERTEX}
          fragmentShader={CORE_FRAGMENT}
          uniforms={coreUniforms}
        />
      </mesh>
      <mesh scale={1.22} raycast={() => null}>
        <sphereGeometry args={[CORE_RADIUS, 64, 64]} />
        <shaderMaterial
          ref={haloMaterialRef}
          vertexShader={HALO_VERTEX}
          fragmentShader={HALO_FRAGMENT}
          uniforms={haloUniforms}
          side={THREE.BackSide}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

// ── Filaments and shell ─────────────────────────────────────────────────────

function Filaments() {
  const dim = useCortex((state) => state.selected !== null && state.selected !== "core");
  const { lines, dots } = useMemo(() => buildFilaments(CORE_RADIUS, SHELL_RADIUS), []);
  const lineMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const dotMaterialRef = useRef<THREE.ShaderMaterial>(null);

  const lineUniforms = useMemo(() => ({ uOpacity: { value: 1 } }), []);
  const dotUniforms = useMemo(
    () => ({ uOpacity: { value: 1 }, uSize: { value: 3.4 }, uPixelRatio: { value: 1 } }),
    [],
  );

  useEffect(
    () => () => {
      lines.dispose();
      dots.dispose();
    },
    [lines, dots],
  );

  useFrame((state, delta) => {
    const lineMaterial = lineMaterialRef.current;
    const dotMaterial = dotMaterialRef.current;
    if (!lineMaterial || !dotMaterial) return;
    const d = Math.min(delta, 0.1);
    lineMaterial.uniforms.uOpacity.value = THREE.MathUtils.damp(
      lineMaterial.uniforms.uOpacity.value,
      dim ? 0.42 : 1,
      3,
      d,
    );
    dotMaterial.uniforms.uOpacity.value = THREE.MathUtils.damp(
      dotMaterial.uniforms.uOpacity.value,
      dim ? 0.55 : 1,
      3,
      d,
    );
    dotMaterial.uniforms.uPixelRatio.value = state.viewport.dpr;
  });

  return (
    <>
      <lineSegments geometry={lines} raycast={() => null}>
        <shaderMaterial
          ref={lineMaterialRef}
          vertexShader={LINE_VERTEX}
          fragmentShader={LINE_FRAGMENT}
          uniforms={lineUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
      <points geometry={dots} raycast={() => null}>
        <shaderMaterial
          ref={dotMaterialRef}
          vertexShader={DOT_VERTEX}
          fragmentShader={DOT_FRAGMENT}
          uniforms={dotUniforms}
          transparent
          depthWrite={false}
        />
      </points>
    </>
  );
}

// ── Capability pins ─────────────────────────────────────────────────────────

function Pin({ capability }: { capability: Capability }) {
  const lobe = LOBE_BY_ID[capability.lobe];
  const isSelected = useCortex((state) => state.selected === capability.id);
  const isHovered = useCortex((state) => state.hovered === capability.id);
  const quiet = useCortex(
    (state) =>
      state.selected !== null && state.selected !== "core" && state.selected !== capability.id,
  );
  const select = useCortex((state) => state.select);
  const hover = useCortex((state) => state.hover);

  const { start, node } = useMemo(() => {
    const direction = new THREE.Vector3(...pinDirection(capability.id));
    return {
      start: direction.clone().multiplyScalar(CORE_RADIUS * 1.02),
      node: direction.clone().multiplyScalar(PIN_RADIUS),
    };
  }, [capability.id]);

  const nodeRef = useRef<THREE.Group>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const world = useMemo(() => new THREE.Vector3(), []);
  const origin = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const group = nodeRef.current;
    if (!group) return;
    const d = Math.min(delta, 0.1);
    group.getWorldPosition(world);
    group.parent?.getWorldPosition(origin);
    // +1 faces the viewer, -1 sits behind the core.
    const facing = (world.z - origin.z) / PIN_RADIUS;
    const front = THREE.MathUtils.clamp((facing + 0.35) / 0.6, 0, 1);

    const label = labelRef.current;
    if (label) {
      const emphasis = isSelected || isHovered ? 1 : quiet ? 0.5 : 0.92;
      label.style.opacity = String(Math.max(0.1, front) * emphasis);
      label.style.pointerEvents = front > 0.35 ? "auto" : "none";
    }

    const target = isSelected ? 1.7 : isHovered ? 1.4 : 1;
    group.scale.setScalar(THREE.MathUtils.damp(group.scale.x, target, 8, d));
  });

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.delta > DRAG_SLOP) return;
    select(capability.id);
  };

  return (
    <group>
      <Line
        points={[start, node]}
        color={lobe.glow}
        lineWidth={isSelected ? 2.8 : isHovered ? 2.1 : 1.3}
        transparent
        opacity={quiet ? 0.32 : 0.95}
        toneMapped={false}
      />
      <group ref={nodeRef} position={node}>
        <mesh raycast={() => null}>
          <sphereGeometry args={[0.05, 24, 24]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
        <Billboard>
          <mesh raycast={() => null}>
            <ringGeometry args={[0.08, 0.095, 48]} />
            <meshBasicMaterial
              color={lobe.glow}
              transparent
              opacity={quiet ? 0.45 : 0.95}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
          {isSelected && (
            <mesh raycast={() => null}>
              <ringGeometry args={[0.145, 0.155, 64]} />
              <meshBasicMaterial
                color="#ffffff"
                transparent
                opacity={0.8}
                side={THREE.DoubleSide}
                toneMapped={false}
              />
            </mesh>
          )}
        </Billboard>
        <mesh
          onClick={onClick}
          onPointerOver={(event) => {
            event.stopPropagation();
            hover(capability.id);
          }}
          onPointerOut={() => hover(null)}
        >
          <sphereGeometry args={[0.26, 12, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        <Html zIndexRange={[30, 10]} style={{ pointerEvents: "none" }}>
          <div ref={labelRef} data-cortex-label className="-translate-y-1/2 translate-x-3.5">
            <button
              type="button"
              // A label press is not a drag of the brain.
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => select(capability.id)}
              onMouseEnter={() => hover(capability.id)}
              onMouseLeave={() => hover(null)}
              onFocus={() => hover(capability.id)}
              onBlur={() => hover(null)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px] font-semibold tracking-[0.01em] backdrop-blur-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                isSelected
                  ? "border-white bg-white text-[#2A1F6E]"
                  : "border-white/25 bg-[#2A1F6E]/35 text-white hover:bg-[#2A1F6E]/55"
              }`}
            >
              <span className="size-1.5 rounded-full" style={{ background: lobe.glow }} />
              {capability.name}
            </button>
          </div>
        </Html>
      </group>
    </group>
  );
}

// ── Rig: turns the brain and frames it ──────────────────────────────────────

function Rig({
  controlRef,
  children,
}: {
  controlRef: MutableRefObject<Control>;
  children: ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const selected = useCortex((state) => state.selected);
  const hovered = useCortex((state) => state.hovered);

  useEffect(() => {
    if (!selected || selected === "core") return;
    const [x, y, z] = pinDirection(selected);
    const yaw = Math.atan2(-x, z);
    const pitch = Math.atan2(y, Math.hypot(x, z));
    controlRef.current.yaw += wrapAngle(yaw - controlRef.current.yaw);
    controlRef.current.pitch = THREE.MathUtils.clamp(pitch, -0.9, 0.9);
  }, [selected, controlRef]);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const d = Math.min(delta, 0.1);
    const control = controlRef.current;
    const focused = selected !== null && selected !== "core";
    if (!focused && !hovered && !control.dragging && !control.reduced) {
      controlRef.current.yaw += d * 0.055;
    }
    group.rotation.y = THREE.MathUtils.damp(group.rotation.y, control.yaw, 3.2, d);
    group.rotation.x = THREE.MathUtils.damp(group.rotation.x, control.pitch, 3.2, d);

    const camera = state.camera as THREE.PerspectiveCamera;
    const size = state.size;
    const aspect = size.width / Math.max(size.height, 1);
    // Portrait screens back the camera off so the shell and its right-hand labels fit the width.
    const fit = aspect >= 1 ? 10.4 : (10.4 / Math.max(aspect, 0.42)) * 1.15;
    const open = selected !== null;
    camera.position.z = THREE.MathUtils.damp(camera.position.z, open ? fit * 0.92 : fit, 2.6, d);

    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const halfW = halfH * aspect;
    const wide = size.width >= 1024;
    const targetX = open && wide ? -halfW * 0.3 : 0;
    const targetY = open && !wide ? halfH * 0.4 : 0;
    group.position.x = THREE.MathUtils.damp(group.position.x, targetX, 3, d);
    group.position.y = THREE.MathUtils.damp(group.position.y, targetY, 3, d);
  });

  return (
    <group ref={groupRef} rotation={[0.12, 0, 0]}>
      {children}
    </group>
  );
}

// ── Scene ───────────────────────────────────────────────────────────────────

export function BrainScene() {
  const select = useCortex((state) => state.select);
  const hovered = useCortex((state) => state.hovered);
  const controlRef = useRef<Control>({
    yaw: 0,
    pitch: 0.12,
    dragging: false,
    moved: 0,
    reduced: false,
  });

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      controlRef.current.reduced = query.matches;
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    controlRef.current.dragging = true;
    controlRef.current.moved = 0;
    let lastX = event.clientX;
    let lastY = event.clientY;

    const move = (e: PointerEvent) => {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      const control = controlRef.current;
      control.moved += Math.abs(dx) + Math.abs(dy);
      control.yaw += dx * 0.006;
      control.pitch = THREE.MathUtils.clamp(control.pitch + dy * 0.004, -0.9, 0.9);
    };
    const up = () => {
      controlRef.current.dragging = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <div
      className={`absolute inset-0 touch-none select-none ${hovered ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}`}
      onPointerDown={onPointerDown}
    >
      <Canvas
        flat
        dpr={[1, 2]}
        camera={{ position: [0, 0, 10.4], fov: 40, near: 0.1, far: 100 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onPointerMissed={(event) => {
          // Labels are DOM over the canvas: their clicks reach here with no 3D hit.
          const target = event.target as Element | null;
          if (target?.closest?.("[data-cortex-label]")) return;
          if (controlRef.current.moved > DRAG_SLOP) return;
          select(null);
        }}
      >
        <Backdrop />
        <Rig controlRef={controlRef}>
          <Core />
          <Filaments />
          {CAPABILITIES.map((capability) => (
            <Pin key={capability.id} capability={capability} />
          ))}
        </Rig>
        <EffectComposer>
          <Bloom mipmapBlur intensity={0.5} luminanceThreshold={0.85} luminanceSmoothing={0.15} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
