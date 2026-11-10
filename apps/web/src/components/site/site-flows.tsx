"use client";

import { useMemo, useRef, type ComponentRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import type { FlowKind, SiteFlow, SiteLayout } from "@/lib/site-layouts";
import { FLOW_COLOR, projector } from "./site-geometry";

const PIPE_Y = 1.1;
const UPLINK_HEIGHT = 48;

/** Wells by their photo position, so a flow ending at a wellhead can carry on down the casing. */
function wellDepths(layout: SiteLayout): Map<string, number> {
  const depths = new Map<string, number>();
  for (const object of layout.objects) {
    for (const part of object.parts) {
      if (part.shape === "well") depths.set(part.at.join(","), part.depthM);
    }
  }
  return depths;
}

function flowPoints(
  flow: SiteFlow,
  p: ReturnType<typeof projector>,
  depths: Map<string, number>,
  subsurface: boolean,
): THREE.Vector3[] {
  if (flow.uplink) {
    const [x, z] = p.xz(flow.path[0]);
    return [new THREE.Vector3(x, 4, z), new THREE.Vector3(x, UPLINK_HEIGHT, z)];
  }

  if (flow.kind === "data") {
    const [ax, az] = p.xz(flow.path[0]);
    const [bx, bz] = p.xz(flow.path[flow.path.length - 1]);
    const a = new THREE.Vector3(ax, 3.4, az);
    const b = new THREE.Vector3(bx, 3.4, bz);
    const mid = a.clone().lerp(b, 0.5);
    mid.y = 8 + a.distanceTo(b) * 0.28;
    return new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(40);
  }

  const points = flow.path.map((px) => {
    const [x, z] = p.xz(px);
    return new THREE.Vector3(x, PIPE_Y, z);
  });
  const end = flow.path[flow.path.length - 1];
  const depth = depths.get(end.join(","));
  if (subsurface && depth) {
    const last = points[points.length - 1];
    points.push(new THREE.Vector3(last.x, -depth * 0.95, last.z));
  }
  return points;
}

function curveThrough(points: THREE.Vector3[]): THREE.CurvePath<THREE.Vector3> {
  const path = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 1; i < points.length; i += 1) {
    path.add(new THREE.LineCurve3(points[i - 1], points[i]));
  }
  return path;
}

/** Small beads riding along the flow, for physical flows. */
function Beads({ points, color }: { points: THREE.Vector3[]; color: string }) {
  const group = useRef<THREE.Group>(null);
  const curve = useMemo(() => curveThrough(points), [points]);
  const length = useMemo(() => Math.max(1, curve.getLength()), [curve]);
  const count = Math.max(3, Math.min(14, Math.round(length / 14)));
  const phase = useRef(0);

  useFrame((_, delta) => {
    const node = group.current;
    if (!node) return;
    // About 9 m/s along the path, whatever its length.
    phase.current = (phase.current + (Math.min(delta, 0.1) * 9) / length) % 1;
    node.children.forEach((child, index) => {
      const u = (phase.current + index / count) % 1;
      child.position.copy(curve.getPointAt(u));
    });
  });

  return (
    <group ref={group}>
      {Array.from({ length: count }, (_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[0.75, 12, 10]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function FlowLine({
  flow,
  points,
  compact,
}: {
  flow: SiteFlow;
  points: THREE.Vector3[];
  compact: boolean;
}) {
  const line = useRef<ComponentRef<typeof Line>>(null);
  const color = FLOW_COLOR[flow.kind];
  const isData = flow.kind === "data";

  useFrame((_, delta) => {
    const material = line.current?.material as { dashOffset?: number } | undefined;
    if (material && typeof material.dashOffset === "number") {
      material.dashOffset -= Math.min(delta, 0.1) * (isData ? 6 : 4);
    }
  });

  return (
    <>
      <Line
        ref={line}
        points={points}
        color={color}
        lineWidth={isData ? 1.6 : 3.4}
        dashed
        dashSize={isData ? 2 : 3}
        gapSize={isData ? 2.2 : 1.2}
        transparent
        opacity={isData ? 0.85 : 0.95}
      />
      {!isData ? <Beads points={points} color={color} /> : null}
      {flow.uplink && !compact ? (
        <Html position={points[points.length - 1]} center zIndexRange={[30, 10]}>
          <span className="rounded-full bg-carbon-400 px-2.5 py-1 text-[10.5px] font-semibold whitespace-nowrap text-white shadow">
            MinRV · Sentinel
          </span>
        </Html>
      ) : null}
    </>
  );
}

export function SiteFlows({
  layout,
  visible,
  subsurface,
  compact = false,
}: {
  layout: SiteLayout;
  visible: Record<FlowKind, boolean>;
  subsurface: boolean;
  compact?: boolean;
}) {
  const flows = useMemo(() => {
    const p = projector(layout);
    const depths = wellDepths(layout);
    return layout.flows.map((flow) => ({
      flow,
      points: flowPoints(flow, p, depths, subsurface),
    }));
  }, [layout, subsurface]);

  return (
    <>
      {flows
        .filter(({ flow }) => visible[flow.kind])
        .map(({ flow, points }) => (
          <FlowLine
            key={`${flow.id}-${subsurface ? "deep" : "surface"}`}
            flow={flow}
            points={points}
            compact={compact}
          />
        ))}
    </>
  );
}
