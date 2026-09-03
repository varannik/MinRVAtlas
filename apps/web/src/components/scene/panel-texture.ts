import * as THREE from "three";

const TILE_WIDTH = 512;
const TILE_HEIGHT = 256;

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) return lines;
    } else {
      current = candidate;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface TileContent {
  label: string;
  value: string;
  unit: string;
  accent: string;
}

export function createTileTexture(tile: TileContent): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_WIDTH;
  canvas.height = TILE_HEIGHT;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    const pad = 16;
    const backdrop = ctx.createLinearGradient(0, 0, TILE_WIDTH, TILE_HEIGHT);
    backdrop.addColorStop(0, "#0e1a2c");
    backdrop.addColorStop(1, "#060b15");
    roundRect(ctx, pad, pad, TILE_WIDTH - pad * 2, TILE_HEIGHT - pad * 2, 28);
    ctx.fillStyle = backdrop;
    ctx.fill();
    ctx.strokeStyle = withAlpha(tile.accent, 0.32);
    ctx.lineWidth = 2;
    ctx.stroke();

    roundRect(ctx, pad + 14, pad + 26, 6, TILE_HEIGHT - pad * 2 - 52, 3);
    ctx.fillStyle = tile.accent;
    ctx.fill();

    ctx.textAlign = "left";
    ctx.fillStyle = "#8ea3c4";
    ctx.font = "600 22px system-ui, sans-serif";
    wrapLines(ctx, tile.label.toUpperCase(), TILE_WIDTH - 110, 2).forEach(
      (line, index) => {
        ctx.fillText(line, pad + 38, 74 + index * 28);
      },
    );

    ctx.fillStyle = "#eef4ff";
    ctx.font = "700 68px system-ui, sans-serif";
    ctx.fillText(tile.value, pad + 38, 190);
    const valueWidth = ctx.measureText(tile.value).width;

    ctx.fillStyle = tile.accent;
    ctx.font = "600 24px system-ui, sans-serif";
    ctx.fillText(tile.unit, pad + 48 + valueWidth, 190);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
