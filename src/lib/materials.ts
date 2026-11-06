// Procedural surface textures for the renderer, drawn on canvases so they work offline.
import * as THREE from "three";
import type { RoomType } from "../shared/plan";

export type Surface = "oak" | "walnut" | "tile" | "stone" | "concrete" | "carpet";

export const ROOM_SURFACE: Record<RoomType, Surface> = {
  living: "oak", dining: "oak", hall: "oak", office: "walnut", bedroom: "carpet",
  kitchen: "stone", bathroom: "tile", laundry: "tile", storage: "concrete", balcony: "concrete", other: "oak",
};

/** Real-world size (metres) covered by one texture repeat. */
export const SURFACE_SCALE: Record<Surface, number> = {
  oak: 1.6, walnut: 1.6, tile: 1.2, stone: 1.8, concrete: 2.4, carpet: 1.0,
};

// Deterministic noise so renders are stable between captures
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function canvas(size = 512) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")!] as const;
}

function speckle(ctx: CanvasRenderingContext2D, size: number, rand: () => number, count: number, alpha: number, dark = true) {
  for (let i = 0; i < count; i++) {
    const v = dark ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${rand() * alpha})`;
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
  }
}

function drawWood(ctx: CanvasRenderingContext2D, size: number, base: [number, number, number], rand: () => number) {
  const planks = 6;
  const pw = size / planks;
  for (let i = 0; i < planks; i++) {
    const shade = 0.88 + rand() * 0.2;
    const [r, g, b] = base.map((c) => Math.min(255, c * shade));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(i * pw, 0, pw, size);
    // grain
    for (let k = 0; k < 40; k++) {
      ctx.strokeStyle = `rgba(60,35,15,${0.04 + rand() * 0.08})`;
      ctx.lineWidth = 0.6 + rand() * 1.4;
      const x0 = i * pw + rand() * pw;
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      for (let y = 0; y <= size; y += 32) ctx.lineTo(x0 + Math.sin(y / 60 + k) * 2.5, y);
      ctx.stroke();
    }
    // plank seams: long edge + staggered butt joint
    ctx.fillStyle = "rgba(40,25,12,0.45)";
    ctx.fillRect(i * pw, 0, 1.5, size);
    ctx.fillRect(i * pw, ((i * 0.37) % 1) * size, pw, 1.5);
  }
}

const cache = new Map<string, THREE.Texture>();

export function surfaceTexture(kind: Surface): THREE.Texture {
  const hit = cache.get(kind);
  if (hit) return hit;
  const size = 512;
  const [c, ctx] = canvas(size);
  const rand = rng(kind.length * 977 + kind.charCodeAt(0));
  switch (kind) {
    case "oak":
      drawWood(ctx, size, [196, 160, 118], rand);
      break;
    case "walnut":
      drawWood(ctx, size, [128, 92, 64], rand);
      break;
    case "tile": {
      ctx.fillStyle = "#d9dcdb";
      ctx.fillRect(0, 0, size, size);
      const n = 4, t = size / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const s = 228 + rand() * 14;
          ctx.fillStyle = `rgb(${s},${s + 2},${s + 2})`;
          ctx.fillRect(i * t + 3, j * t + 3, t - 6, t - 6);
        }
      speckle(ctx, size, rand, 2500, 0.06);
      break;
    }
    case "stone": {
      ctx.fillStyle = "#cfc9bf";
      ctx.fillRect(0, 0, size, size);
      speckle(ctx, size, rand, 9000, 0.12);
      speckle(ctx, size, rand, 4000, 0.15, false);
      ctx.fillStyle = "rgba(90,85,78,0.35)";
      ctx.fillRect(0, size / 2, size, 2);
      ctx.fillRect(size / 2, 0, 2, size);
      break;
    }
    case "concrete": {
      ctx.fillStyle = "#b9b6b0";
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 60; i++) {
        const cx = rand() * size, cy = rand() * size;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40 + rand() * 120);
        g.addColorStop(0, `rgba(0,0,0,${rand() * 0.05})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
      }
      speckle(ctx, size, rand, 8000, 0.1);
      ctx.fillStyle = "rgba(70,70,70,0.3)";
      ctx.fillRect(0, 0, size, 2);
      ctx.fillRect(0, 0, 2, size);
      break;
    }
    case "carpet": {
      ctx.fillStyle = "#c9c2b6";
      ctx.fillRect(0, 0, size, size);
      speckle(ctx, size, rand, 30000, 0.12);
      speckle(ctx, size, rand, 15000, 0.1, false);
      break;
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  cache.set(kind, tex);
  return tex;
}

/** A clone of the shared texture with repeats set for a floor of the given size (metres). */
export function floorTexture(kind: Surface, w: number, d: number) {
  const t = surfaceTexture(kind).clone();
  t.needsUpdate = true;
  const s = SURFACE_SCALE[kind];
  t.repeat.set(w / s, d / s);
  return t;
}

/** Subtle fabric weave for upholstery and bedding. */
export function fabricTexture() {
  const hit = cache.get("fabric");
  if (hit) return hit;
  const [c, ctx] = canvas(256);
  const rand = rng(42);
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 2) {
    ctx.fillStyle = `rgba(255,255,255,${0.04 + rand() * 0.05})`;
    ctx.fillRect(0, y, 256, 1);
  }
  for (let x = 0; x < 256; x += 2) {
    ctx.fillStyle = `rgba(0,0,0,${0.04 + rand() * 0.05})`;
    ctx.fillRect(x, 0, 1, 256);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  cache.set("fabric", t);
  return t;
}
