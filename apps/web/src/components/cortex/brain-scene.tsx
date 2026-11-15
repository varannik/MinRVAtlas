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

function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

const CORE_VERTEX = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vObj = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const CORE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uPulse;
  uniform vec3 uCellA;
  uniform vec3 uCellB;
  uniform vec3 uWall;
  uniform vec3 uRim;
  varying vec3 vObj;
  varying vec3 vNormalW;
  varying vec3 vViewDir;

  vec3 hash3(vec3 p) {
    p = vec3(
      dot(p, vec3(127.1, 311.7, 74.7)),
      dot(p, vec3(269.5, 183.3, 246.1)),
      dot(p, vec3(113.5, 271.9, 124.6))
    );
    return fract(sin(p) * 43758.5453123);
  }

  // x: distance to nearest cell, y: to second nearest, z: nearest cell id.
  vec3 worley(vec3 p) {
    vec3 cell = floor(p);
    vec3 local = fract(p);
    float f1 = 8.0;
    float f2 = 8.0;
    float id = 0.0;
    for (int x = -1; x <= 1; x++) {
      for (int y = -1; y <= 1; y++) {
        for (int z = -1; z <= 1; z++) {
          vec3 g = vec3(float(x), float(y), float(z));
          vec3 h = hash3(cell + g);
          vec3 o = 0.5 + 0.38 * sin(uTime * 0.32 + 6.2831 * h);
          vec3 r = g + o - local;
          float d = dot(r, r);
          if (d < f1) {
            f2 = f1;
            f1 = d;
            id = h.x;
          } else if (d < f2) {
            f2 = d;
          }
        }
      }
    }
    return vec3(sqrt(f1), sqrt(f2), id);
  }

  void main() {
    vec3 p = normalize(vObj) * 4.4;
    vec3 w = worley(p);
    float edge = w.y - w.x;
    float wall = 1.0 - smoothstep(0.03, 0.17, edge);
    float dome = 1.0 - smoothstep(0.0, 0.75, w.x);

    vec3 cell = mix(uCellA, uCellB, w.z);
    cell *= 0.72 + 0.42 * dome;
    vec3 colour = mix(cell, uWall, wall);

    vec3 n = normalize(vNormalW);
    vec3 v = normalize(vViewDir);
    vec3 l = normalize(vec3(-0.45, 0.7, 0.6));
    float spec = pow(max(dot(reflect(-l, n), v), 0.0), 28.0) * (1.0 - wall);
    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 2.2);

    colour += spec * 0.55;
    colour = mix(colour, uRim, fresnel * 0.7);
    colour += uRim * fresnel * (0.12 + 0.4 * uPulse);
    gl_FragColor = vec4(colour, 1.0);
  }
`;

const HALO_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HALO_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec3 vNormal;
  void main() {
    float intensity = pow(clamp(0.74 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 3.0);
    gl_FragColor = vec4(uColor, intensity * uStrength);
  }
`;

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

const LINE_VERTEX = /* glsl */ `
  attribute float aT;
  varying float vT;
  void main() {
    vT = aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LINE_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying float vT;
  void main() {
    float alpha = mix(0.3, 0.2, smoothstep(0.0, 1.0, vT)) * uOpacity;
    gl_FragColor = vec4(vec3(1.0), alpha);
  }
`;

const DOT_VERTEX = /* glsl */ `
  uniform float uSize;
  uniform float uPixelRatio;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * uPixelRatio * (9.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const DOT_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.12, d) * uOpacity;
    gl_FragColor = vec4(vec3(1.0), alpha);
  }
`;

function buildFilaments() {
  const random = mulberry32(4401);
  const linePositions: number[] = [];
  const lineT: number[] = [];
  const dotPositions: number[] = [];

  const jitter = new THREE.Vector3();
  const start = new THREE.Vector3();
  const direction = new THREE.Vector3();

  for (let latDeg = -78; latDeg <= 78; latDeg += 12) {
    const lat = THREE.MathUtils.degToRad(latDeg);
    const count = Math.max(8, Math.round(52 * Math.cos(lat)));
    const phase = ((latDeg + 78) / 12) % 2 === 0 ? 0 : Math.PI / count;
    for (let i = 0; i < count; i++) {
      const lon = (i / count) * Math.PI * 2 + phase;
      direction.set(
        Math.sin(lon) * Math.cos(lat),
        Math.sin(lat),
        Math.cos(lon) * Math.cos(lat),
      );
      const tip = direction.clone().multiplyScalar(SHELL_RADIUS);
      dotPositions.push(tip.x, tip.y, tip.z);

      // Paired dots, as on a printed dial.
      if (random() < 0.55) {
        const twin = lon + 0.03;
        dotPositions.push(
          Math.sin(twin) * Math.cos(lat) * SHELL_RADIUS,
          Math.sin(lat) * SHELL_RADIUS,
          Math.cos(twin) * Math.cos(lat) * SHELL_RADIUS,
        );
      }

      if (random() < 0.74) {
        jitter.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).multiplyScalar(0.95);
        start.copy(direction).add(jitter).normalize().multiplyScalar(CORE_RADIUS * 0.96);
        linePositions.push(start.x, start.y, start.z, tip.x, tip.y, tip.z);
        lineT.push(0, 1);
      }
    }
  }

  const lines = new THREE.BufferGeometry();
  lines.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
  lines.setAttribute("aT", new THREE.Float32BufferAttribute(lineT, 1));

  const dots = new THREE.BufferGeometry();
  dots.setAttribute("position", new THREE.Float32BufferAttribute(dotPositions, 3));

  return { lines, dots };
}

function Filaments() {
  const dim = useCortex((state) => state.selected !== null && state.selected !== "core");
  const { lines, dots } = useMemo(() => buildFilaments(), []);
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
