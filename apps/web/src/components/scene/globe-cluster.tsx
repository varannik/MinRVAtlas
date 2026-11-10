"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import ThreeGlobe from "three-globe";
import { STATUS_META } from "@/lib/projects";
import { isStageMode, useStageMode } from "@/hooks/use-stage-mode";
import { useVisibleProjects } from "@/hooks/use-visible-projects";
import { useDashboard } from "@/store/dashboard-store";
import { stageAnchors } from "../stage/stage-anchors";
import { dragState } from "./drag-state";
import { globeBand } from "./layout";
import type { Project } from "@/lib/types";

// three-globe works in a fixed 100-unit radius, so the cluster is scaled down to r=2.
const GLOBE_SCALE = 0.02;
const BASE_RADIUS = 2;
const UP = new THREE.Vector3(0, 1, 0);

// When a project's desk is open the globe becomes a large, distant backdrop behind the scrim.
const BACKDROP_SCALE = 3.1;
const BACKDROP_Z = -11;

// On the project stage the pin sits above the globe's centre so its stick reads.
const STAGE_PITCH_OFFSET = 0.18;
// Share of the free band the stage globe fills, leaving air around it.
const STAGE_FILL = 0.84;
// Head of a selected pin, in three-globe units above the surface.
const PIN_HEAD = 10;
// After a drag on the stage, turn back to the pin after this long.
const STAGE_RETURN_S = 2.6;

const _head = new THREE.Vector3();
const _center = new THREE.Vector3();
const _toCamera = new THREE.Vector3();

function toRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function useCursor(active: boolean) {
  useEffect(() => {
    if (!active) return;
    document.body.style.cursor = "pointer";
    return () => {
      document.body.style.cursor = "auto";
    };
  }, [active]);
}

interface PinProps {
  project: Project;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  selected: boolean;
  hovered: boolean;
  interactive: boolean;
  fade: number;
}

function Pin({
  project,
  position,
  quaternion,
  selected,
  hovered,
  interactive,
  fade,
}: PinProps) {
  const headRef = useRef<THREE.Mesh>(null);
  const stickRef = useRef<THREE.Mesh>(null);
  const focusProject = useDashboard((state) => state.focusProject);
  const hoverProject = useDashboard((state) => state.hoverProject);
  const color = STATUS_META[project.status].color;
  const active = selected || hovered;

  useCursor(hovered && interactive);

  useFrame((state, delta) => {
    const step = Math.min(delta, 0.1);
    const targetHeight = selected ? 10 : hovered ? 8 : 5;

    if (stickRef.current) {
      const height = THREE.MathUtils.damp(
        stickRef.current.scale.y,
        targetHeight,
        6,
        step,
      );
      stickRef.current.scale.y = height;
      stickRef.current.position.y = height / 2;
    }

    if (headRef.current) {
      const pulse = active
        ? 1 + Math.sin(state.clock.elapsedTime * 4) * 0.12
        : 1;
      headRef.current.scale.setScalar(
        THREE.MathUtils.damp(
          headRef.current.scale.x,
          (active ? 1.5 : 1) * pulse,
          8,
          step,
        ),
      );
      headRef.current.position.y = stickRef.current?.scale.y ?? 5;
    }
  });

  return (
    <group position={position} quaternion={quaternion}>
      {interactive ? (
        <mesh
          onPointerOver={(event) => {
            event.stopPropagation();
            hoverProject(project.id);
          }}
          onPointerOut={() => hoverProject(null)}
          onClick={(event) => {
            event.stopPropagation();
            if (dragState.moved) return;
            focusProject(selected ? null : project.id);
          }}
        >
          <sphereGeometry args={[5.5, 12, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ) : null}

      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.6, 0.22, 8, 40]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={(active ? 1 : 0.7) * fade}
        />
      </mesh>

      <mesh ref={stickRef} position={[0, 2.5, 0]}>
        <cylinderGeometry args={[0.22, 0.22, 1, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.75 * fade} />
      </mesh>

      <mesh ref={headRef} position={[0, 5, 0]}>
        <sphereGeometry args={[1.5, 20, 20]} />
        <meshBasicMaterial color={color} transparent opacity={fade} />
      </mesh>

      {active && interactive ? (
        <Html
          position={[0, (selected ? 10 : 8) + 3, 0]}
          center
          style={{ pointerEvents: "none" }}
        >
          <div className="glass -translate-y-[calc(50%+22px)] rounded-xl px-3 py-2 whitespace-nowrap shadow-2xl">
            <div className="text-[11px] font-semibold tracking-wide text-frost">
              {project.name}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-mist">
              <span
                className="inline-block size-1.5 rounded-full"
                style={{ background: color }}
              />
              {STATUS_META[project.status].label} · {project.country}
            </div>
          </div>
        </Html>
      ) : null}
    </group>
  );
}

export function GlobeCluster() {
  const outerRef = useRef<THREE.Group>(null);
  const spinRef = useRef<THREE.Group>(null);
  const innerRef = useRef<THREE.Group>(null);
  const target = useRef({ yaw: 0, pitch: -0.12 });
  const manual = useRef(false);
  const lastDrag = useRef(0);
  const zoom = useRef(1);

  const { gl, viewport, camera, size, clock } = useThree();
  const projects = useVisibleProjects();
  const selectedProjectId = useDashboard((state) => state.selectedProjectId);
  const focusedProjectId = useDashboard((state) => state.focusedProjectId);
  const hoveredProjectId = useDashboard((state) => state.hoveredProjectId);
  const stage = useStageMode();
  const backdrop = Boolean(selectedProjectId) && !stage;
  // The project the globe faces: the open one, else the focused one.
  const facingId = selectedProjectId ?? focusedProjectId;

  const globe = useMemo(() => {
    const instance = new ThreeGlobe({ animateIn: false });
    instance.showAtmosphere(true);
    instance.atmosphereColor("#beb290");
    instance.atmosphereAltitude(0.14);
    instance.globeMaterial(
      new THREE.MeshPhongMaterial({
        color: new THREE.Color("#d9d4c8"),
        emissive: new THREE.Color("#f1f0f0"),
        emissiveIntensity: 0.18,
        shininess: 8,
        transparent: true,
        opacity: 0.98,
      }),
    );
    instance.ringResolution(64);
    return instance;
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/countries.geojson")
      .then((response) => response.json())
      .then((collection: { features: object[] }) => {
        if (cancelled) return;
        globe
          .hexPolygonsData(collection.features)
          .hexPolygonResolution(3)
          .hexPolygonMargin(0.52)
          .hexPolygonUseDots(true)
          .hexPolygonAltitude(0.006)
          .hexPolygonColor(() => "#6f663f");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [globe]);

  useEffect(() => {
    globe
      .ringsData(
        projects.map((project) => ({
          lat: project.lat,
          lng: project.lng,
          rgb: toRgb(STATUS_META[project.status].color),
        })),
      )
      .ringAltitude(0.007)
      .ringMaxRadius(3.4)
      .ringPropagationSpeed(1.1)
      .ringRepeatPeriod(1600)
      .ringColor((ring: object) => {
        const [r, g, b] = (ring as { rgb: [number, number, number] }).rgb;
        return (t: number) => `rgba(${r},${g},${b},${Math.max(0, 1 - t) * 0.6})`;
      });
  }, [globe, projects]);

  const pins = useMemo(
    () =>
      projects.map((project) => {
        const coords = globe.getCoords(project.lat, project.lng, 0.001);
        const position = new THREE.Vector3(coords.x, coords.y, coords.z);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(
          UP,
          position.clone().normalize(),
        );
        return { project, position, quaternion };
      }),
    [globe, projects],
  );

  const tenantId = useDashboard((state) => state.tenantId);

  useEffect(() => {
    manual.current = false;
  }, [facingId, tenantId]);

  useEffect(() => {
    const element = gl.domElement;
    let active = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (event: PointerEvent) => {
      active = true;
      dragState.moved = false;
      lastX = event.clientX;
      lastY = event.clientY;
    };

    const onMove = (event: PointerEvent) => {
      if (!active) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) dragState.moved = true;
      // The backdrop globe stays locked on the open project; the stage globe
      // can be turned and springs back to the pin.
      if (useDashboard.getState().selectedProjectId && !isStageMode()) return;
      manual.current = true;
      lastDrag.current = clock.elapsedTime;
      target.current.yaw += dx * 0.005;
      target.current.pitch = THREE.MathUtils.clamp(
        target.current.pitch + dy * 0.005,
        -1.15,
        1.15,
      );
    };

    const onUp = () => {
      active = false;
    };

    const onWheel = (event: WheelEvent) => {
      if (useDashboard.getState().selectedProjectId) return;
      event.preventDefault();
      zoom.current = THREE.MathUtils.clamp(
        zoom.current - event.deltaY * 0.0012,
        0.72,
        1.2,
      );
    };

    element.addEventListener("pointerdown", onDown);
    element.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    return () => {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [clock, gl]);

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.1);
    const spin = spinRef.current;
    const outer = outerRef.current;
    if (!spin || !outer) return;

    const selected = projects.find((project) => project.id === facingId);

    if (manual.current && stage && clock.elapsedTime - lastDrag.current > STAGE_RETURN_S) {
      manual.current = false;
    }

    if (!manual.current) {
      if (selected) {
        target.current.yaw = -selected.lng * THREE.MathUtils.DEG2RAD;
        target.current.pitch = (selected.lat * THREE.MathUtils.DEG2RAD) - (stage ? STAGE_PITCH_OFFSET : 0);
      } else if (projects.length > 0 && projects.length <= 3) {
        // A small portfolio should face the pin, not hide it on the far side
        // of a spinning globe.
        const lng =
          projects.reduce((sum, project) => sum + project.lng, 0) /
          projects.length;
        const lat =
          projects.reduce((sum, project) => sum + project.lat, 0) /
          projects.length;
        target.current.yaw = -lng * THREE.MathUtils.DEG2RAD;
        target.current.pitch = THREE.MathUtils.damp(
          target.current.pitch,
          lat * THREE.MathUtils.DEG2RAD,
          2,
          step,
        );
      } else {
        target.current.yaw += step * 0.05;
        target.current.pitch = THREE.MathUtils.damp(
          target.current.pitch,
          -0.12,
          2,
          step,
        );
      }
    }

    const twoPi = Math.PI * 2;
    target.current.yaw +=
      twoPi * Math.round((spin.rotation.y - target.current.yaw) / twoPi);

    spin.rotation.y = THREE.MathUtils.damp(
      spin.rotation.y,
      target.current.yaw,
      3.4,
      step,
    );
    spin.rotation.x = THREE.MathUtils.damp(
      spin.rotation.x,
      target.current.pitch,
      3.4,
      step,
    );

    // Fit the sphere into the band the DOM panels leave free.
    const band = globeBand(viewport);
    const radius = Math.min(band.radius * zoom.current, viewport.height / 2 - 0.4);
    let targetX = backdrop ? 0 : band.center;
    let targetY = backdrop ? 0.1 : band.centerY;
    const targetZ = backdrop ? BACKDROP_Z : 0;
    let targetScale = backdrop ? BACKDROP_SCALE : radius / BASE_RADIUS;

    const gap = stageAnchors.band;
    if (stage && gap.valid) {
      const factor = viewport.factor;
      const widthPx = gap.right - gap.left;
      const heightPx = gap.bottom - gap.top;
      const stageRadius = THREE.MathUtils.clamp((Math.min(widthPx / 2 - 36, heightPx / 2 - 70) * STAGE_FILL) / factor, 0.55, 2.5);
      targetX = ((gap.left + gap.right) / 2 - size.width / 2) / factor;
      targetY = camera.position.y + (size.height / 2 - (gap.top + gap.bottom) / 2) / factor - stageRadius * 0.08;
      targetScale = stageRadius / BASE_RADIUS;
    }

    outer.position.x = THREE.MathUtils.damp(outer.position.x, targetX, 3, step);
    outer.position.y = THREE.MathUtils.damp(outer.position.y, targetY, 3, step);
    outer.position.z = THREE.MathUtils.damp(outer.position.z, targetZ, 3, step);
    outer.scale.setScalar(
      THREE.MathUtils.damp(outer.scale.x, targetScale, 3, step),
    );

    // Where the open pin's head lands on screen, for the stage's flows.
    const pinAnchor = stageAnchors.pin;
    const pin = stage ? pins.find((row) => row.project.id === selectedProjectId) : null;
    const inner = innerRef.current;
    if (!pin || !inner) {
      pinAnchor.visible = false;
      return;
    }
    _head.copy(pin.position).addScaledVector(pin.position.clone().normalize(), PIN_HEAD);
    inner.localToWorld(_head);
    outer.getWorldPosition(_center);
    _toCamera.copy(camera.position).sub(_head);
    const facing = _head.clone().sub(_center).dot(_toCamera) > 0;
    _head.project(camera);
    pinAnchor.x = ((_head.x + 1) / 2) * size.width;
    pinAnchor.y = ((1 - _head.y) / 2) * size.height;
    pinAnchor.visible = facing && Math.abs(_head.x) < 1 && Math.abs(_head.y) < 1;
  });

  useEffect(
    () => () => {
      stageAnchors.pin.visible = false;
    },
    [],
  );

  return (
    <group ref={outerRef} scale={0.001}>
      <group ref={spinRef}>
        <group ref={innerRef} scale={GLOBE_SCALE}>
          <primitive object={globe} />
          {pins.map(({ project, position, quaternion }) => (
            <Pin
              key={project.externalProjectId ?? project.id}
              project={project}
              position={position}
              quaternion={quaternion}
              selected={project.id === facingId}
              hovered={project.id === hoveredProjectId}
              interactive={!selectedProjectId}
              fade={backdrop ? 0.4 : stage && project.id !== selectedProjectId ? 0.3 : 1}
            />
          ))}
        </group>
      </group>
    </group>
  );
}
