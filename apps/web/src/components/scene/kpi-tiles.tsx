"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { createTileTexture, type TileContent } from "./panel-texture";
import {
  TILE_HEIGHT,
  TILE_ROW_GAP,
  TILE_WIDTH,
  tileColumnX,
  tileFit,
} from "./layout";

function Tile({
  tile,
  index,
  visible,
}: {
  tile: TileContent;
  index: number;
  visible: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const texture = useMemo(() => createTileTexture(tile), [tile]);
  useEffect(() => () => texture.dispose(), [texture]);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const step = Math.min(delta, 0.1);
    const target = visible ? 1 : 0.001;
    group.scale.setScalar(
      THREE.MathUtils.damp(group.scale.x, target, 4 + index * 0.4, step),
    );
    group.position.z =
      Math.sin(state.clock.elapsedTime * 0.6 + index * 0.9) * 0.06;
    group.visible = group.scale.x > 0.02;
  });

  return (
    <group ref={groupRef} position={[0, -index * TILE_ROW_GAP, 0]} scale={0.001}>
      <mesh>
        <planeGeometry args={[TILE_WIDTH, TILE_HEIGHT]} />
        <meshBasicMaterial
          map={texture}
          transparent
          alphaTest={0.2}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

export function KpiTiles({
  tiles,
  visible,
}: {
  tiles: TileContent[];
  visible: boolean;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const { viewport } = useThree();

  useFrame((_, delta) => {
    const root = rootRef.current;
    if (!root) return;
    const step = Math.min(delta, 0.1);
    const fit = tileFit(viewport);
    const columnX = tileColumnX(viewport, fit);

    root.position.x = THREE.MathUtils.damp(
      root.position.x,
      visible ? columnX : columnX + TILE_WIDTH * fit + 0.8,
      3,
      step,
    );
    root.position.y = ((tiles.length - 1) * TILE_ROW_GAP * fit) / 2;
    root.scale.setScalar(THREE.MathUtils.damp(root.scale.x, fit, 3, step));
  });

  return (
    <group ref={rootRef} position={[6, 1.3, 0]} rotation={[0, -0.24, 0]} scale={0.8}>
      {tiles.map((tile, index) => (
        <Tile key={tile.label} tile={tile} index={index} visible={visible} />
      ))}
    </group>
  );
}
