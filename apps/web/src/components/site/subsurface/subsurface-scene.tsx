"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import type { Evidence, SubsurfaceLayer } from "@/lib/site-layouts";
import { phasesAt, resistivitySection, type Phases } from "./dfn";
import type { PlacedWell, Subsurface, SubsurfaceView } from "./model";

export const EVIDENCE_COLOR: Record<Evidence, string> = {
  measured: "#2F7D4F",
  interpreted: "#B0791C",
  simulated: "#6E58C9",
};

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  measured: "Measured",
  interpreted: "Interpreted",
  simulated: "Simulated",
};

/** Colour conventions from the research brief. */
export const PROCESS_COLOR = {
  fluid: "#2F7FE0",
  dissolved: "#4FD6E8",
  reaction: "#E8892C",
  carbonate: "#F4F1EA",
  open: "#2E3338",
  partial: "#9C8B63",
  sealed: "#CFC8B6",
  selected: "#FFD84D",
} as const;

function EvidenceTag({ evidence }: { evidence: Evidence }) {
  return (
    <span
      className="rounded px-1 py-px text-[9px] font-semibold tracking-wide text-white uppercase"
      style={{ background: EVIDENCE_COLOR[evidence] }}
    >
      {EVIDENCE_LABEL[evidence]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Geology: each layer is drawn as the far walls of a cut-away block, so the
// fractures and wells inside stay visible from any side.

const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });

function LayerSlab({ layer, sub, floor }: { layer: SubsurfaceLayer; sub: Subsurface; floor: boolean }) {
  const { frame } = sub;
  const height = layer.base - layer.top;
  const walls = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: layer.color,
        roughness: 1,
        side: THREE.BackSide,
        transparent: true,
        opacity: 0.88,
      }),
    [layer.color],
  );
  // BoxGeometry faces: +x, −x, +y, −y, +z, −z. Top stays open; only the
  // block's lowest layer shows a floor.
  const materials = useMemo(
    () => [walls, walls, HIDDEN, floor ? walls : HIDDEN, walls, walls],
    [floor, walls],
  );
  useEffect(() => () => walls.dispose(), [walls]);

  const outline = useMemo(() => {
    const x0 = frame.centre.x - frame.halfLength;
    const x1 = frame.centre.x + frame.halfLength;
    const z0 = frame.centre.z - frame.halfWidth;
    const z1 = frame.centre.z + frame.halfWidth;
    const y = -layer.top;
    return [
      [x0, y, z0],
      [x1, y, z0],
      [x1, y, z1],
      [x0, y, z1],
      [x0, y, z0],
    ] as [number, number, number][];
  }, [frame, layer.top]);

  return (
    <group>
      <mesh
        position={[frame.centre.x, -(layer.top + layer.base) / 2, frame.centre.z]}
        material={materials}
        raycast={() => null}
      >
        <boxGeometry args={[frame.halfLength * 2, height, frame.halfWidth * 2]} />
      </mesh>
      <Line points={outline} color="#3b342c" lineWidth={1} transparent opacity={0.45} />
      <Html
        position={[frame.centre.x + frame.halfLength + 8, -(layer.top + layer.base) / 2, frame.centre.z + frame.halfWidth]}
        zIndexRange={[10, 0]}
      >
        <span className="flex items-center gap-1.5 rounded bg-white/90 px-1.5 py-0.5 text-[10.5px] whitespace-nowrap shadow-sm">
          <span className="size-2 rounded-sm" style={{ background: layer.color }} />
          <span className="font-semibold text-rock">{layer.name}</span>
          <span className="text-shale">
            {layer.top}–{layer.base} m
          </span>
          <EvidenceTag evidence={layer.evidence} />
        </span>
      </Html>
    </group>
  );
}

/** Dashed frame at the top and base of the injection interval. */
function InjectionInterval({ sub }: { sub: Subsurface }) {
  const { frame, model } = sub;
  const ring = (depth: number) => {
    const x0 = frame.centre.x - frame.halfLength;
    const x1 = frame.centre.x + frame.halfLength;
    const z0 = frame.centre.z - frame.halfWidth;
    const z1 = frame.centre.z + frame.halfWidth;
    return [
      [x0, -depth, z0],
      [x1, -depth, z0],
      [x1, -depth, z1],
      [x0, -depth, z1],
      [x0, -depth, z0],
    ] as [number, number, number][];
  };
  return (
    <>
      {[model.reservoir.top, model.reservoir.base].map((depth) => (
        <Line key={depth} points={ring(depth)} color="#7B4FB3" lineWidth={2} dashed dashSize={10} gapSize={6} />
      ))}
    </>
  );
}

function DepthRuler({ sub }: { sub: Subsurface }) {
  const { frame, model } = sub;
  const x = frame.centre.x - frame.halfLength - 12;
  const z = frame.centre.z + frame.halfWidth;
  const ticks = Array.from({ length: Math.floor(model.block.bottom / 100) + 1 }, (_, i) => i * 100);
  return (
    <group>
      <Line points={[[x, 0, z], [x, -model.block.bottom, z]]} color="#57544A" lineWidth={1.4} />
      {ticks.map((depth) => (
        <group key={depth}>
          <Line points={[[x - 6, -depth, z], [x, -depth, z]]} color="#57544A" lineWidth={1.4} />
          <Html position={[x - 10, -depth, z]} center zIndexRange={[10, 0]}>
            <span className="text-[10px] font-medium whitespace-nowrap text-shale">−{depth} m</span>
          </Html>
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Fracture network: instanced planes, coloured by fill state and by how far
// the fluid, reaction and carbonate fronts have travelled.

const Z_AXIS = new THREE.Vector3(0, 0, 1);

function fractureColour(
  f: Subsurface["dfn"]["fractures"][number],
  phases: Phases,
  selected: boolean,
  out: THREE.Color,
) {
  if (selected) return out.set(PROCESS_COLOR.selected);
  const base = out.set(PROCESS_COLOR[f.state]);
  if (!f.connected || f.arrival > phases.front) return base;
  let wet: string;
  if (f.arrival <= phases.carbonate) wet = PROCESS_COLOR.carbonate;
  else if (f.arrival <= phases.reaction) wet = PROCESS_COLOR.reaction;
  else if (phases.front - f.arrival < 0.06) wet = PROCESS_COLOR.dissolved;
  else wet = PROCESS_COLOR.fluid;
  const mineralised = f.arrival <= phases.carbonate;
  // Free fluid fades after injection stops; carbonate stays.
  return base.lerp(new THREE.Color(wet), mineralised ? 1 : phases.fluid);
}

function Fractures({
  sub,
  view,
  phases,
  onSelect,
}: {
  sub: Subsurface;
  view: SubsurfaceView;
  phases: Phases;
  onSelect: (index: number | null) => void;
}) {
  const planes = useRef<THREE.InstancedMesh>(null);
  const halos = useRef<THREE.InstancedMesh>(null);
  const { fractures } = sub.dfn;
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const shown = view.visible.fractures;
  const layerShown = view.visible;

  // Placement changes only when layers are shown or hidden.
  useEffect(() => {
    const mesh = planes.current;
    const halo = halos.current;
    if (!mesh || !halo) return;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const normal = new THREE.Vector3();
    for (const f of fractures) {
      const visible = shown && layerShown[f.layerId] !== false;
      normal.set(...f.normal);
      quaternion.setFromUnitVectors(Z_AXIS, normal);
      position.set(f.x, f.y, f.z);
      scale.set(visible ? f.length : 0, visible ? f.height : 0, 1);
      mesh.setMatrixAt(f.index, matrix.compose(position, quaternion, scale));
      scale.multiplyScalar(1.7);
      halo.setMatrixAt(f.index, matrix.compose(position, quaternion, scale));
    }
    mesh.instanceMatrix.needsUpdate = true;
    halo.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [fractures, layerShown, shown]);

  // Colours follow the timeline.
  useEffect(() => {
    const mesh = planes.current;
    const halo = halos.current;
    if (!mesh || !halo) return;
    const colour = new THREE.Color();
    const glow = new THREE.Color();
    for (const f of fractures) {
      mesh.setColorAt(f.index, fractureColour(f, phases, view.selectedFracture === f.index, colour));
      // Halo: dissolved carbon (cyan) ahead of the reaction, reaction (orange)
      // ahead of carbonate; nothing once mineralised or before the fluid arrives.
      if (!view.visible.reaction || !f.connected || f.arrival > phases.front || f.arrival <= phases.carbonate) {
        glow.setRGB(0, 0, 0);
      } else if (f.arrival <= phases.reaction) {
        glow.set(PROCESS_COLOR.reaction).multiplyScalar(0.55);
      } else {
        glow.set(PROCESS_COLOR.dissolved).multiplyScalar(0.4 * phases.fluid);
      }
      halo.setColorAt(f.index, glow);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (halo.instanceColor) halo.instanceColor.needsUpdate = true;
  }, [fractures, phases, view.selectedFracture, view.visible.reaction]);

  return (
    <>
      <instancedMesh
        ref={planes}
        args={[geometry, undefined, fractures.length]}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          if (event.instanceId !== undefined) onSelect(event.instanceId);
        }}
        onPointerOver={() => {
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      >
        <meshStandardMaterial side={THREE.DoubleSide} transparent opacity={0.82} roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={halos} args={[geometry, undefined, fractures.length]} raycast={() => null}>
        <meshBasicMaterial
          side={THREE.DoubleSide}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>
    </>
  );
}

/** White points where carbonate has precipitated (simulated). */
function Carbonate({ sub, phases }: { sub: Subsurface; phases: Phases }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions = new Float32Array(sub.dfn.specks.length * 3);
    sub.dfn.specks.forEach((speck, i) => positions.set([speck.x, speck.y, speck.z], i * 3));
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [sub.dfn.specks]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useEffect(() => {
    // Specks are sorted by arrival, so the visible ones are a prefix.
    let count = 0;
    while (count < sub.dfn.specks.length && sub.dfn.specks[count].arrival <= phases.carbonate) count += 1;
    geometry.setDrawRange(0, count);
  }, [geometry, phases.carbonate, sub.dfn.specks]);

  return (
    <points geometry={geometry} raycast={() => null}>
      <pointsMaterial color={PROCESS_COLOR.carbonate} size={4} sizeAttenuation={false} depthWrite={false} />
    </points>
  );
}

function Microseismic({ sub, phases }: { sub: Subsurface; phases: Phases }) {
  const group = useRef<THREE.Group>(null);
  useFrame((state) => {
    const node = group.current;
    if (!node) return;
    const pulse = 1 + 0.35 * Math.sin(state.clock.elapsedTime * 6);
    node.children.forEach((child, i) => {
      const event = sub.dfn.events[i];
      const fresh = phases.front - event.arrival;
      const size = event.arrival > phases.front ? 0 : fresh < 0.12 && phases.injecting ? 5.5 * pulse : 2.4;
      child.scale.setScalar(size);
    });
  });
  return (
    <group ref={group}>
      {sub.dfn.events.map((event) => (
        <mesh key={event.fracture} position={[event.x, event.y, event.z]} scale={0} raycast={() => null}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshBasicMaterial color="#D7263D" transparent opacity={0.85} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Wells: casing and cement, perforated or screened intervals, sensors.

const INTERVAL_STYLE = {
  casing: { radius: 2, color: "#8E969E" },
  perforated: { radius: 2.4, color: "#7B4FB3" },
  screen: { radius: 2.3, color: "#3A8FD6" },
  geophones: { radius: 1.6, color: "#8E969E" },
} as const;

const SENSOR_COLOR = {
  "pressure-temperature": "#E0A526",
  sampling: "#3A8FD6",
  geophone: "#C6362B",
} as const;

function Well({
  placed,
  labelDrop,
  phases,
  tracerArrived,
  selected,
  onSelect,
}: {
  placed: PlacedWell;
  /** Extra metres below the well bottom, so labels of wells ending at the same depth don't overlap. */
  labelDrop: number;
  phases: Phases;
  tracerArrived: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { well, object, x, z, depth } = placed;
  const ringSpacing = 25;

  return (
    <group
      position={[x, 0, z]}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        onSelect(object.id);
      }}
    >
      {well.intervals.map((interval) => {
        const style = INTERVAL_STYLE[interval.kind];
        const length = interval.base - interval.top;
        const active = interval.kind === "perforated" && phases.injecting;
        return (
          <group key={interval.label}>
            <mesh position={[0, -(interval.top + interval.base) / 2, 0]}>
              <cylinderGeometry args={[style.radius, style.radius, length, 14]} />
              <meshStandardMaterial
                color={active ? "#2F7FE0" : style.color}
                metalness={interval.kind === "casing" ? 0.6 : 0.1}
                roughness={0.4}
                emissive={active ? "#2F7FE0" : selected ? "#7B4FB3" : "#000000"}
                emissiveIntensity={active ? 0.6 : selected ? 0.4 : 0}
              />
            </mesh>
            {interval.kind === "casing" ? (
              // Cement sheath around the casing.
              <mesh position={[0, -(interval.top + interval.base) / 2, 0]} raycast={() => null}>
                <cylinderGeometry args={[3.3, 3.3, length, 14, 1, true]} />
                <meshStandardMaterial color="#D8D2C4" transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} />
              </mesh>
            ) : null}
            {interval.kind === "perforated" || interval.kind === "screen"
              ? Array.from({ length: Math.floor(length / ringSpacing) + 1 }, (_, i) => (
                  <mesh
                    key={i}
                    position={[0, -(interval.top + i * ringSpacing), 0]}
                    rotation={[Math.PI / 2, 0, 0]}
                    raycast={() => null}
                  >
                    <torusGeometry args={[style.radius + 1.4, 0.45, 6, 18]} />
                    <meshBasicMaterial color={style.color} />
                  </mesh>
                ))
              : null}
          </group>
        );
      })}
      {well.sensors.map((sensor, i) => {
        const detected = sensor.kind === "sampling" && well.role === "observation" && tracerArrived;
        const colour = detected ? "#4FD6E8" : SENSOR_COLOR[sensor.kind];
        return (
          <mesh key={`${sensor.label}-${i}`} position={[0, -sensor.depth, 0]}>
            <sphereGeometry args={[detected ? 5.5 : 4, 16, 12]} />
            <meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={detected ? 0.8 : 0.25} />
          </mesh>
        );
      })}
      <Html position={[0, -depth - 14 - labelDrop, 0]} center zIndexRange={[20, 0]}>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(object.id);
          }}
          className={`pointer-events-auto rounded-md bg-white/92 px-1.5 py-0.5 text-left text-[10px] whitespace-nowrap shadow-sm ${
            selected ? "ring-2 ring-[#7B4FB3]" : "ring-1 ring-line"
          }`}
        >
          <span className="font-semibold text-rock">{object.code ?? object.name}</span>
          <span className="text-shale"> · {depth} m</span>
          {showsTracer(well.role, tracerArrived) ? <span className="ml-1 font-semibold text-[#1d8fa3]">tracer detected</span> : null}
        </button>
      </Html>
    </group>
  );
}

function showsTracer(role: PlacedWell["well"]["role"], tracerArrived: boolean) {
  return role === "observation" && tracerArrived;
}

// ---------------------------------------------------------------------------
// TEM: survey grid at the surface and a resistivity section through the wells.

function TemGrid({ sub }: { sub: Subsurface }) {
  const { frame, model } = sub;
  const geometry = useMemo(() => {
    const spacing = model.tem.stationSpacing;
    const x0 = frame.centre.x - frame.halfLength;
    const z0 = frame.centre.z - frame.halfWidth;
    const nx = Math.round((frame.halfLength * 2) / spacing);
    const nz = Math.round((frame.halfWidth * 2) / spacing);
    const lines: number[] = [];
    const stations: number[] = [];
    for (let i = 0; i <= nx; i += 1) lines.push(x0 + i * spacing, 0.5, z0, x0 + i * spacing, 0.5, z0 + nz * spacing);
    for (let j = 0; j <= nz; j += 1) lines.push(x0, 0.5, z0 + j * spacing, x0 + nx * spacing, 0.5, z0 + j * spacing);
    for (let i = 0; i <= nx; i += 1) for (let j = 0; j <= nz; j += 1) stations.push(x0 + i * spacing, 0.8, z0 + j * spacing);
    const grid = new THREE.BufferGeometry();
    grid.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    const points = new THREE.BufferGeometry();
    points.setAttribute("position", new THREE.Float32BufferAttribute(stations, 3));
    return { grid, points };
  }, [frame, model.tem.stationSpacing]);
  useEffect(
    () => () => {
      geometry.grid.dispose();
      geometry.points.dispose();
    },
    [geometry],
  );

  return (
    <group>
      <lineSegments geometry={geometry.grid} raycast={() => null}>
        <lineBasicMaterial color="#1f6f8b" transparent opacity={0.55} />
      </lineSegments>
      <points geometry={geometry.points} raycast={() => null}>
        <pointsMaterial color="#0e3d4f" size={5} sizeAttenuation={false} />
      </points>
      <Html
        position={[frame.centre.x - frame.halfLength, 2, frame.centre.z - frame.halfWidth]}
        zIndexRange={[10, 0]}
      >
        <span className="flex items-center gap-1.5 rounded bg-white/90 px-1.5 py-0.5 text-[10.5px] whitespace-nowrap shadow-sm">
          <span className="font-semibold text-rock">TEM survey area 700 × 300 m</span>
          <EvidenceTag evidence={model.tem.evidence} />
        </span>
      </Html>
    </group>
  );
}

const SECTION_W = 140;
const SECTION_H = 190;

function TemSection({ sub, view, phases }: { sub: Subsurface; view: SubsurfaceView; phases: Phases }) {
  const { frame, model } = sub;
  // Recompute on coarse timeline steps only.
  const step = Math.round(view.t * 20) / 20;
  const texture = useMemo(() => {
    if (view.section === "off") return null;
    const pixels = resistivitySection(model, sub.dfn, frame, phasesAt(step), view.section, SECTION_W, SECTION_H);
    const t = new THREE.DataTexture(pixels, SECTION_W, SECTION_H);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }, [frame, model, step, sub.dfn, view.section]);
  useEffect(() => () => texture?.dispose(), [texture]);

  if (view.section === "off" || !texture) return null;
  return (
    <group>
      <mesh position={[frame.centre.x, -model.block.bottom / 2, frame.well.z]} raycast={() => null}>
        <planeGeometry args={[frame.halfLength * 2, model.block.bottom]} />
        <meshBasicMaterial map={texture} transparent side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Html position={[frame.centre.x + frame.halfLength * 0.55, -140, frame.well.z]} center zIndexRange={[10, 0]}>
        <span className="flex items-center gap-1.5 rounded bg-white/90 px-1.5 py-0.5 text-[10.5px] whitespace-nowrap shadow-sm">
          <span className="font-semibold text-rock">
            TEM resistivity section · {view.section === "baseline" ? "baseline" : "change since baseline"}
          </span>
          <EvidenceTag evidence={view.section === "baseline" ? "interpreted" : "simulated"} />
          {phases.front === 0 && view.section === "change" ? <span className="text-shale">no injection yet</span> : null}
        </span>
      </Html>
    </group>
  );
}

// ---------------------------------------------------------------------------

export function SubsurfaceScene({
  sub,
  view,
  selectedId,
  onSelect,
  onSelectFracture,
}: {
  sub: Subsurface;
  view: SubsurfaceView;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSelectFracture: (index: number | null) => void;
}) {
  const phases = useMemo(() => phasesAt(view.t), [view.t]);
  const lowest = sub.model.layers.reduce((a, b) => (b.base > a.base ? b : a), sub.model.layers[0]);
  const tracerArrived =
    sub.dfn.observationArrival !== null && sub.dfn.observationArrival <= phases.front;

  return (
    <group>
      {sub.model.layers
        .filter((layer) => view.visible[layer.id] !== false)
        .map((layer) => (
          <LayerSlab key={layer.id} layer={layer} sub={sub} floor={layer.id === lowest.id} />
        ))}
      <InjectionInterval sub={sub} />
      <DepthRuler sub={sub} />
      <Fractures sub={sub} view={view} phases={phases} onSelect={onSelectFracture} />
      {view.visible.reaction ? <Carbonate sub={sub} phases={phases} /> : null}
      {view.visible.seismic ? <Microseismic sub={sub} phases={phases} /> : null}
      {view.visible.wells
        ? sub.wells.map((placed, index) => (
            <Well
              key={placed.object.id}
              placed={placed}
              labelDrop={
                sub.wells.slice(0, index).filter((other) => Math.abs(other.depth - placed.depth) < 20).length * 26
              }
              phases={phases}
              tracerArrived={tracerArrived}
              selected={selectedId === placed.object.id}
              onSelect={onSelect}
            />
          ))
        : null}
      {view.visible.tem ? <TemGrid sub={sub} /> : null}
      <TemSection sub={sub} view={view} phases={phases} />
    </group>
  );
}
