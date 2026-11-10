"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { Html, Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import type { SensorStatus, SiteLayout, SiteObject, SitePart } from "@/lib/site-layouts";
import {
  ZONE_COLOR,
  footprint,
  labelPoint,
  objectTop,
  projector,
  yaw,
} from "./site-geometry";
import { sensorKey, type SensorReadings } from "./use-site-sensors";

type Project = ReturnType<typeof projector>;

export const STATUS_COLOR = {
  ok: "#8B9C44",
  warn: "#E8923A",
  alarm: "#C6362B",
} as const;

function PartMesh({
  part,
  p,
  zoneColor,
  glow,
  faded,
}: {
  part: SitePart;
  p: Project;
  zoneColor: string;
  glow: number;
  faded: boolean;
}) {
  const [x, z] = p.xz(part.at);
  const material = (color: string) => (
    <meshStandardMaterial
      color={color}
      roughness={0.75}
      metalness={0.05}
      emissive={zoneColor}
      emissiveIntensity={glow}
      transparent={faded}
      opacity={faded ? 0.55 : 1}
    />
  );

  if (part.shape === "box") {
    const h = part.heightM;
    return (
      <mesh
        position={[x, h / 2, z]}
        rotation={[0, yaw(part.rotateDeg), 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[p.len(part.size[0]), h, p.len(part.size[1])]} />
        {material(part.color ?? "#e4e1da")}
      </mesh>
    );
  }

  if (part.shape === "cylinder") {
    const r = p.len(part.radiusPx);
    const h = part.heightM;
    return (
      <group position={[x, 0, z]}>
        <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[r, r, h, 64, 1, part.water]} />
          <meshStandardMaterial
            color={part.color ?? "#e4e1da"}
            roughness={0.7}
            emissive={zoneColor}
            emissiveIntensity={glow}
            side={part.water ? THREE.DoubleSide : THREE.FrontSide}
          />
        </mesh>
        {part.water ? (
          <mesh position={[0, h * 0.78, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[r * 0.99, 64]} />
            <meshStandardMaterial color="#1f2d33" roughness={0.15} metalness={0.2} />
          </mesh>
        ) : null}
      </group>
    );
  }

  if (part.shape === "solar") {
    const w = p.len(part.size[0]);
    const d = p.len(part.size[1]);
    const row = d / part.rows;
    return (
      <group position={[x, 0, z]} rotation={[0, yaw(part.rotateDeg), 0]}>
        {Array.from({ length: part.rows }, (_, i) => (
          <mesh
            key={i}
            position={[0, 1.3, -d / 2 + row * (i + 0.5)]}
            rotation={[-0.42, 0, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[w, 0.12, row * 0.66]} />
            <meshStandardMaterial
              color="#1d3557"
              roughness={0.35}
              metalness={0.35}
              emissive={zoneColor}
              emissiveIntensity={glow}
            />
          </mesh>
        ))}
      </group>
    );
  }

  // Well: a small wellhead on a concrete pad; the casing is drawn by the subsurface model.
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.15, 0]} receiveShadow>
        <boxGeometry args={[3.4, 0.3, 3.4]} />
        <meshStandardMaterial color="#b9b4a8" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.4, 0]} castShadow>
        <cylinderGeometry args={[0.35, 0.45, 2.2, 16]} />
        <meshStandardMaterial
          color={zoneColor}
          roughness={0.5}
          emissive={zoneColor}
          emissiveIntensity={0.15 + glow}
        />
      </mesh>
      <mesh position={[0, 2.7, 0]} castShadow>
        <boxGeometry args={[1.1, 0.5, 1.1]} />
        <meshStandardMaterial color="#d9d4ea" roughness={0.6} />
      </mesh>
    </group>
  );
}

function ZoneOutline({ object, p, strong }: { object: SiteObject; p: Project; strong: boolean }) {
  const points = useMemo(() => {
    const [x0, y0, x1, y1] = footprint(object);
    return ([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]] as const).map(
      ([x, y]) => {
        const [sx, sz] = p.xz([x, y]);
        return new THREE.Vector3(sx, 0.12, sz);
      },
    );
  }, [object, p]);

  return (
    <Line
      points={points}
      color={ZONE_COLOR[object.zone]}
      lineWidth={strong ? 3.2 : 2}
      dashed
      dashSize={2.4}
      gapSize={1.6}
    />
  );
}

const STATUS_RANK = { ok: 0, warn: 1, alarm: 2 } as const;

/**
 * One-line label: object name, worst sensor status and the first reading.
 * Expands to every reading on hover or when selected.
 */
function ObjectLabel({
  object,
  p,
  readings,
  selected,
  expanded,
  onSelect,
}: {
  object: SiteObject;
  p: Project;
  readings: SensorReadings;
  selected: boolean;
  expanded: boolean;
  onSelect: (id: string) => void;
}) {
  const [x, z] = p.xz(labelPoint(object));
  const sensors = object.sensors ?? [];
  const color = ZONE_COLOR[object.zone];
  const title = object.code ?? object.name;
  const rows = sensors.map((sensor) => ({ sensor, reading: readings[sensorKey(object.id, sensor.id)] }));
  const worst = rows.reduce<SensorStatus>(
    (acc, { reading }) =>
      reading && STATUS_RANK[reading.status] > STATUS_RANK[acc] ? reading.status : acc,
    "ok",
  );
  const first = rows[0];

  return (
    <Html position={[x, objectTop(object) + 5, z]} center zIndexRange={[selected ? 40 : 30, 10]}>
      <button
        type="button"
        onClick={(event) => {
          // Labels render in their own React root inside the canvas wrapper;
          // without this the canvas reads the click as a miss and clears the selection.
          event.stopPropagation();
          onSelect(object.id);
        }}
        className={`pointer-events-auto block rounded-lg bg-white/92 text-left whitespace-nowrap shadow-[0_4px_14px_rgba(7,8,8,0.14)] backdrop-blur ${
          selected ? "ring-2" : "ring-1"
        }`}
        style={{ ["--tw-ring-color" as string]: color }}
      >
        <span className="flex items-center gap-1.5 px-2 py-1">
          <span className="size-1.5 shrink-0 rounded-sm" style={{ background: color }} />
          <span className="text-[10.5px] font-semibold text-rock">{title}</span>
          {first && !expanded ? (
            <>
              <span className="mx-0.5 h-3 w-px bg-line" />
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[worst] }} />
              <span className="font-mono text-[10.5px] font-semibold text-rock tabular-nums">
                {first.reading?.text ?? "—"}
              </span>
              <span className="text-[9.5px] text-shale">{first.sensor.unit}</span>
              {rows.length > 1 ? <span className="text-[9.5px] text-mist">+{rows.length - 1}</span> : null}
            </>
          ) : null}
        </span>
        {expanded && rows.length > 0 ? (
          <span className="block space-y-0.5 px-2 pb-1">
            {rows.map(({ sensor, reading }) => (
              <span key={sensor.id} className="flex items-center gap-1.5">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: reading ? STATUS_COLOR[reading.status] : "#ccc" }}
                />
                <span className="text-[10px] text-shale">{sensor.label}</span>
                <span className="ml-auto pl-2 font-mono text-[10.5px] font-semibold text-rock tabular-nums">
                  {reading?.text ?? "—"}
                </span>
                <span className="text-[9.5px] text-shale">{sensor.unit}</span>
              </span>
            ))}
          </span>
        ) : null}
      </button>
    </Html>
  );
}

export function SiteObjects({
  layout,
  readings,
  selectedId,
  hoveredId,
  labels = true,
  subsurface,
  onSelect,
  onHover,
}: {
  layout: SiteLayout;
  readings: SensorReadings;
  selectedId: string | null;
  hoveredId: string | null;
  /** False hides every label (preview column). */
  labels?: boolean;
  subsurface: boolean;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}) {
  const p = useMemo(() => projector(layout), [layout]);

  return (
    <>
      {layout.objects.map((object) => {
        const selected = object.id === selectedId;
        const hovered = object.id === hoveredId;
        const glow = selected ? 0.35 : hovered ? 0.2 : 0;
        const hasSensors = Boolean(object.sensors?.length);
        return (
          <group
            key={object.id}
            onClick={(event: ThreeEvent<MouseEvent>) => {
              event.stopPropagation();
              onSelect(object.id);
            }}
            onPointerOver={(event: ThreeEvent<PointerEvent>) => {
              event.stopPropagation();
              onHover(object.id);
              document.body.style.cursor = "pointer";
            }}
            onPointerOut={() => {
              onHover(null);
              document.body.style.cursor = "";
            }}
          >
            {object.parts.map((part, index) => (
              <PartMesh
                key={index}
                part={part}
                p={p}
                zoneColor={ZONE_COLOR[object.zone]}
                glow={glow}
                faded={object.zone === "legacy"}
              />
            ))}
            <ZoneOutline object={object} p={p} strong={selected || hovered} />
            {labels && (selected || (subsurface ? object.zone === "subsurface" : hasSensors)) ? (
              <ObjectLabel
                object={object}
                p={p}
                readings={readings}
                selected={selected}
                expanded={selected || hovered}
                onSelect={onSelect}
              />
            ) : null}
          </group>
        );
      })}
    </>
  );
}
