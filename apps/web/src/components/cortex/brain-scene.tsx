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
  CORE_COLORS,
  SHELL_COLORS,
  buildFilaments,
} from "./brain-parts";

const CORE_RADIUS = 1;
const SHELL_RADIUS = 3;
const PIN_RADIUS = 2.55;
/** Share of a wide screen the open panel takes; the brain shrinks into the rest. */
const PANEL_SHARE = 2 / 3;
/** A light shell: about a third of the default filaments, so the shell never reads as more pins. */
const SHELL_DENSITY = { around: 30, latStep: 15, minPerBand: 6, lineChance: 0.55, twinChance: 0.2 } as const;
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
    // Peridotite: Earth with a low serpentine light, the host rock the CO2 goes into.
    const linear = ctx.createLinearGradient(0, 0, 1024, 1024);
    linear.addColorStop(0, "#0D1802");
    linear.addColorStop(0.55, "#182006");
    linear.addColorStop(1, "#262C10");
    ctx.fillStyle = linear;
    ctx.fillRect(0, 0, 1024, 1024);
    const radial = ctx.createRadialGradient(512, 470, 30, 512, 470, 680);
    radial.addColorStop(0, "rgba(111, 102, 63, 0.55)");
    radial.addColorStop(0.5, "rgba(55, 58, 27, 0.35)");
    radial.addColorStop(1, "rgba(13, 24, 2, 0)");
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, 1024, 1024);

    const gradient = new THREE.CanvasTexture(canvas);
    gradient.colorSpace = THREE.SRGBColorSpace;
    return gradient;
  }, []);

  useEffect(() => () => texture?.dispose(), [texture]);

  if (!texture) return <color attach="background" args={["#0D1802"]} />;
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
      uCellA: { value: new THREE.Color(CORE_COLORS.cellA) },
      uCellB: { value: new THREE.Color(CORE_COLORS.cellB) },
      uWall: { value: new THREE.Color(CORE_COLORS.wall) },
      uRim: { value: new THREE.Color(CORE_COLORS.rim) },
    }),
    [],
  );

  const haloUniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(CORE_COLORS.halo) },
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
  const { lines, dots } = useMemo(() => buildFilaments(CORE_RADIUS, SHELL_RADIUS, SHELL_DENSITY), []);
  const lineMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const dotMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const worldScale = useMemo(() => new THREE.Vector3(), []);

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
      dim ? 0.4 : 0.85,
      3,
      d,
    );
    dotMaterial.uniforms.uOpacity.value = THREE.MathUtils.damp(
      dotMaterial.uniforms.uOpacity.value,
      dim ? 0.4 : 0.7,
      3,
      d,
    );
    dotMaterial.uniforms.uPixelRatio.value = state.viewport.dpr;
    // Smaller dots while the brain is shrunk beside the panel.
    const scale = pointsRef.current?.getWorldScale(worldScale).x ?? 1;
    dotMaterial.uniforms.uSize.value = 2.8 * (0.4 + 0.6 * scale);
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
      <points ref={pointsRef} geometry={dots} raycast={() => null}>
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
  // While a panel is open the brain is small: only the open and hovered pins keep a label.
  const panelOpen = useCortex((state) => state.selected !== null);
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
  const scale = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const group = nodeRef.current;
    if (!group) return;
    const d = Math.min(delta, 0.1);
    group.getWorldPosition(world);
    group.parent?.getWorldPosition(origin);
    group.parent?.getWorldScale(scale);
    // +1 faces the viewer, -1 sits behind the core, whatever size the brain is drawn at.
    const facing = (world.z - origin.z) / (PIN_RADIUS * Math.max(scale.z, 0.01));
    const front = THREE.MathUtils.clamp((facing + 0.35) / 0.6, 0, 1);

    const label = labelRef.current;
    if (label) {
      const emphasis = isSelected || isHovered ? 1 : panelOpen ? 0 : quiet ? 0.5 : 0.92;
      label.style.opacity = emphasis === 0 ? "0" : String(Math.max(0.1, front) * emphasis);
      label.style.pointerEvents = emphasis > 0 && front > 0.35 ? "auto" : "none";
    }

    // Pins keep most of their size when the brain shrinks beside the panel.
    const keep = Math.pow(1 / Math.max(scale.x, 0.3), 0.6);
    const target = (isSelected ? 1.6 : isHovered ? 1.35 : 1) * keep;
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
          <sphereGeometry args={[0.035, 24, 24]} />
          <meshBasicMaterial color={SHELL_COLORS.node} toneMapped={false} />
        </mesh>
        <Billboard>
          {/* A soft halo and a solid lobe disc: a pin reads apart from the shell dots. */}
          <mesh raycast={() => null}>
            <circleGeometry args={[0.17, 48]} />
            <meshBasicMaterial
              color={lobe.glow}
              transparent
              opacity={quiet ? 0.07 : 0.2}
              depthWrite={false}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
          <mesh raycast={() => null}>
            <circleGeometry args={[0.085, 40]} />
            <meshBasicMaterial
              color={lobe.glow}
              transparent
              opacity={quiet ? 0.5 : 1}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
          <mesh raycast={() => null}>
            <ringGeometry args={[0.105, 0.12, 48]} />
            <meshBasicMaterial
              color={lobe.glow}
              transparent
              opacity={quiet ? 0.4 : 0.9}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
          {isSelected && (
            <mesh raycast={() => null}>
              <ringGeometry args={[0.17, 0.182, 64]} />
              <meshBasicMaterial
                color={SHELL_COLORS.node}
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
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px] font-semibold tracking-[0.01em] backdrop-blur-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-calcite ${
                isSelected
                  ? "border-calcite bg-calcite text-earth"
                  : "border-calcite/20 bg-earth/45 text-calcite hover:bg-earth/70"
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
    camera.position.z = THREE.MathUtils.damp(camera.position.z, fit, 2.6, d);

    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const halfW = halfH * aspect;
    const wide = size.width >= 1024;
    // Open on a wide screen: the panel takes the right two thirds and the brain
    // shrinks into the centre of the third that is left. On a narrow screen the
    // panel is a bottom sheet, so the brain shrinks a little and rises.
    let targetScale = 1;
    let targetY = 0;
    let targetShift = 0;
    if (open && wide) {
      const room = halfW * 2 * (1 - PANEL_SHARE);
      targetScale = THREE.MathUtils.clamp((room * 0.8) / (SHELL_RADIUS * 2 + 1.2), 0.3, 0.62);
      // Moving the brain off the camera axis would draw it as an oval. It stays on
      // the axis and the lens shifts instead, so it lands at the centre of the left
      // third (NDC x = -PANEL_SHARE) and stays round.
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      targetShift = PANEL_SHARE * tanHalf * aspect * camera.getFilmWidth();
    } else if (open) {
      targetScale = 0.72;
      targetY = halfH * 0.42;
    }
    group.scale.setScalar(THREE.MathUtils.damp(group.scale.x, targetScale, 3, d));
    group.position.x = THREE.MathUtils.damp(group.position.x, 0, 3, d);
    group.position.y = THREE.MathUtils.damp(group.position.y, targetY, 3, d);
    const shift = THREE.MathUtils.damp(camera.filmOffset, targetShift, 3, d);
    if (Math.abs(shift - camera.filmOffset) > 1e-4) {
      camera.filmOffset = Math.abs(shift - targetShift) < 1e-3 ? targetShift : shift;
      camera.updateProjectionMatrix();
    }
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
