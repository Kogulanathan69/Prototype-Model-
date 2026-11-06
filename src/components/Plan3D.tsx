import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useMemo } from "react";
import {
  DOOR_HEIGHT, FURNITURE_DEFAULTS, SILL_HEIGHT, WALL_HEIGHT, WALL_THICKNESS, planBounds, wallPieces,
  type FloorPlan, type FurnitureType,
} from "../shared/plan";
import { ROOM_FILL } from "./PlanEditor2D";

const M = 1 / 1000; // mm -> metres

const FURNITURE_COLOR: Partial<Record<FurnitureType, string>> = {
  bed_double: "#e8e2d6", bed_single: "#e8e2d6", sofa: "#7d8f86", armchair: "#9a8a72",
  dining_table: "#b08a63", coffee_table: "#b08a63", desk: "#b08a63", chair: "#6f5a45",
  wardrobe: "#d9d2c4", kitchen_counter: "#cfd3cf", fridge: "#e9ecea", stove: "#3c4240",
  sink: "#cfd3cf", toilet: "#fafafa", shower: "#cfe0e6", bathtub: "#fafafa", washbasin: "#fafafa",
  washing_machine: "#eef0ef", tv_unit: "#44403a", bookshelf: "#a07d58", plant: "#6f8a62", rug: "#c9b48f",
};

interface Box { key: string; pos: [number, number, number]; size: [number, number, number]; color: string; rotY?: number; opacity?: number }

export default function Plan3D({ plan }: { plan: FloorPlan }) {
  const { boxes, floors, center, radius } = useMemo(() => build(plan), [plan]);
  return (
    <div className="plan-3d">
      <Canvas shadows camera={{ position: [center[0] + radius * 1.1, radius * 1.5, center[2] + radius * 1.5], fov: 45 }}>
        <color attach="background" args={["#f4f1ea"]} />
        <hemisphereLight args={["#ffffff", "#d8d2c4", 0.9]} />
        <directionalLight position={[center[0] + 6, 14, center[2] + 4]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-20} shadow-camera-right={20} shadow-camera-top={20} shadow-camera-bottom={-20} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center[0], -0.01, center[2]]} receiveShadow>
          <planeGeometry args={[radius * 6, radius * 6]} />
          <meshStandardMaterial color="#e9e5dc" />
        </mesh>
        {floors.map((f) => (
          <mesh key={f.key} position={f.pos} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[f.size[0], f.size[2]]} />
            <meshStandardMaterial color={f.color} />
          </mesh>
        ))}
        {boxes.map((b) => (
          <mesh key={b.key} position={b.pos} rotation={[0, b.rotY ?? 0, 0]} castShadow receiveShadow>
            <boxGeometry args={b.size} />
            <meshStandardMaterial color={b.color} transparent={b.opacity !== undefined} opacity={b.opacity ?? 1} />
          </mesh>
        ))}
        <OrbitControls target={center} maxPolarAngle={Math.PI / 2.05} enableDamping />
      </Canvas>
      <div className="plan-3d-hint">Drag to orbit · scroll to zoom · right-drag to pan</div>
    </div>
  );
}

function build(plan: FloorPlan) {
  const boxes: Box[] = [];
  const floors: Box[] = [];
  const t = WALL_THICKNESS;

  for (const r of plan.rooms) {
    floors.push({
      key: r.id,
      pos: [(r.x + r.width / 2) * M, 0.002, (r.y + r.height / 2) * M],
      size: [r.width * M, 0, r.height * M],
      color: ROOM_FILL[r.type],
    });
  }

  const wallBox = (key: string, o: "horizontal" | "vertical", c: number, a: number, b: number, y0: number, y1: number, color = "#f7f5f0", opacity?: number) => {
    const len = b - a, mid = (a + b) / 2, h = y1 - y0;
    boxes.push({
      key, color, opacity,
      pos: o === "horizontal" ? [mid * M, (y0 + h / 2) * M, c * M] : [c * M, (y0 + h / 2) * M, mid * M],
      size: o === "horizontal" ? [len * M, h * M, t * M] : [t * M, h * M, len * M],
    });
  };

  const { solids, gaps } = wallPieces(plan);
  solids.forEach((s, i) => {
    const a = s.a - (s.capA ? t / 2 : 0), b = s.b + (s.capB ? t / 2 : 0);
    wallBox(`w${i}`, s.orientation, s.c, a, b, 0, WALL_HEIGHT);
  });
  gaps.forEach((g, i) => {
    const { orientation: o, c } = g.seg;
    if (g.kind === "door") {
      wallBox(`dl${i}`, o, c, g.a, g.b, DOOR_HEIGHT, WALL_HEIGHT);
    } else {
      wallBox(`ws${i}`, o, c, g.a, g.b, 0, SILL_HEIGHT);
      wallBox(`wl${i}`, o, c, g.a, g.b, DOOR_HEIGHT, WALL_HEIGHT);
      wallBox(`wg${i}`, o, c, g.a, g.b, SILL_HEIGHT, DOOR_HEIGHT, "#a9c6d3", 0.35);
    }
  });

  for (const f of plan.furniture) {
    const h = FURNITURE_DEFAULTS[f.type].height;
    const color = FURNITURE_COLOR[f.type] ?? "#ddd";
    const rotY = (-f.rotation * Math.PI) / 180;
    if (f.type === "plant") {
      boxes.push({ key: f.id + "p", pos: [f.x * M, 0.15, f.y * M], size: [f.width * 0.5 * M, 0.3, f.depth * 0.5 * M], color: "#9a7b5c" });
      boxes.push({ key: f.id, pos: [f.x * M, (300 + (h - 300) / 2) * M, f.y * M], size: [f.width * M, (h - 300) * M, f.depth * M], color });
      continue;
    }
    boxes.push({ key: f.id, pos: [f.x * M, (h / 2) * M + 0.003, f.y * M], size: [f.width * M, h * M, f.depth * M], color, rotY });
    // A headboard / backrest makes orientation readable in 3D
    if (f.type === "bed_double" || f.type === "bed_single" || f.type === "sofa" || f.type === "armchair") {
      const backH = f.type.startsWith("bed") ? 1000 : 800;
      const back = 160;
      const off = (-f.depth / 2 + back / 2) * M;
      const sin = Math.sin(rotY), cos = Math.cos(rotY);
      boxes.push({
        key: f.id + "b",
        pos: [f.x * M + off * sin, (backH / 2) * M, f.y * M + off * cos],
        size: [f.width * M, backH * M, back * M],
        color: f.type.startsWith("bed") ? "#8c7a64" : color,
        rotY,
      });
    }
  }

  const b = planBounds(plan);
  const center: [number, number, number] = [((b.minX + b.maxX) / 2) * M, 0, ((b.minY + b.maxY) / 2) * M];
  const radius = Math.max(6, (Math.max(b.maxX - b.minX, b.maxY - b.minY) * M) / 1.2);
  return { boxes, floors, center, radius };
}
