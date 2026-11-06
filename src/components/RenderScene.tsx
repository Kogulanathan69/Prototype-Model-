// Scene contents for the render studio: textured floors, walls with framed windows, open doors,
// optional ceilings, lighting presets and furniture modelled in more detail than the quick 3D view.
import { Environment, Lightformer, Sky } from "@react-three/drei";
import { useMemo, type ReactNode } from "react";
import * as THREE from "three";
import {
  DOOR_HEIGHT, FURNITURE_DEFAULTS, SILL_HEIGHT, WALL_HEIGHT, WALL_THICKNESS, planBounds, wallPieces,
  type FloorPlan, type Furniture,
} from "../shared/plan";
import { ROOM_SURFACE, fabricTexture, floorTexture } from "../lib/materials";

export type Lighting = "day" | "golden" | "evening";

const M = 1 / 1000;

const ROUGHNESS = { oak: 0.55, walnut: 0.5, tile: 0.22, stone: 0.38, concrete: 0.9, carpet: 1 } as const;

export function sceneBounds(plan: FloorPlan) {
  const b = planBounds(plan);
  const center = new THREE.Vector3(((b.minX + b.maxX) / 2) * M, 0, ((b.minY + b.maxY) / 2) * M);
  const size = Math.max(b.maxX - b.minX, b.maxY - b.minY) * M;
  return { center, size: Math.max(size, 4) };
}

export default function RenderScene({ plan, lighting, ceiling }: { plan: FloorPlan; lighting: Lighting; ceiling: boolean }) {
  const { center, size } = useMemo(() => sceneBounds(plan), [plan]);
  const sun = useMemo(() => {
    const elev = lighting === "day" ? 52 : lighting === "golden" ? 11 : -8;
    const az = lighting === "day" ? 150 : 245;
    const e = (elev * Math.PI) / 180, a = (az * Math.PI) / 180;
    return new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).multiplyScalar(size * 2);
  }, [lighting, size]);
  const sunColor = lighting === "golden" ? "#ffb575" : "#fff6e8";
  const sunTarget = useMemo(() => new THREE.Object3D(), []);
  const half = size * 0.9;

  return (
    <>
      {lighting === "evening" ? (
        <color attach="background" args={["#1b2230"]} />
      ) : (
        <Sky sunPosition={sun} turbidity={lighting === "golden" ? 9 : 5} rayleigh={lighting === "golden" ? 2.5 : 1.2} mieCoefficient={0.006} mieDirectionalG={0.85} distance={4500} />
      )}
      <Environment resolution={256} frames={1}>
        <Lightformer intensity={lighting === "evening" ? 0.15 : 1.0} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[20, 20, 1]} color={lighting === "golden" ? "#ffe1c2" : "#ffffff"} />
        <Lightformer intensity={lighting === "evening" ? 0.05 : 0.6} position={[8, 2, 0]} rotation-y={-Math.PI / 2} scale={[20, 5, 1]} />
        <Lightformer intensity={lighting === "evening" ? 0.05 : 0.6} position={[-8, 2, 0]} rotation-y={Math.PI / 2} scale={[20, 5, 1]} />
      </Environment>

      <hemisphereLight args={[lighting === "evening" ? "#2b3550" : "#dfe9ff", "#d6cbb8", lighting === "evening" ? 0.25 : 0.38]} />
      {lighting !== "evening" && (
        <directionalLight
          position={[center.x + sun.x, sun.y, center.z + sun.z]}
          target={sunTarget}
          color={sunColor}
          intensity={lighting === "golden" ? 3.2 : 3.6}
          castShadow
          shadow-mapSize={[4096, 4096]}
          shadow-radius={3}
          shadow-bias={-0.0004}
          shadow-normalBias={0.02}
          shadow-camera-left={-half}
          shadow-camera-right={half}
          shadow-camera-top={half}
          shadow-camera-bottom={-half}
          shadow-camera-near={0.1}
          shadow-camera-far={size * 5}
        />
      )}

      <primitive object={sunTarget} position={[center.x, 0, center.z]} />
      {/* Ground around the building */}
      <mesh rotation-x={-Math.PI / 2} position={[center.x, -0.02, center.z]} receiveShadow>
        <planeGeometry args={[size * 12, size * 12]} />
        <meshStandardMaterial color={lighting === "evening" ? "#3a4038" : "#a9ae98"} roughness={1} />
      </mesh>

      <Floors plan={plan} />
      <Walls plan={plan} />
      <Doors plan={plan} />
      {ceiling && <Ceilings plan={plan} />}
      {(lighting === "evening" || ceiling) && <RoomLights plan={plan} strong={lighting === "evening"} />}
      {plan.furniture.map((f) => <FurnitureModel key={f.id} f={f} />)}
    </>
  );
}

function Floors({ plan }: { plan: FloorPlan }) {
  const floors = useMemo(
    () => plan.rooms.map((r) => {
      const kind = ROOM_SURFACE[r.type];
      return { r, kind, map: floorTexture(kind, r.width * M, r.height * M) };
    }),
    [plan.rooms],
  );
  return (
    <>
      {floors.map(({ r, kind, map }) => (
        <mesh key={r.id} rotation-x={-Math.PI / 2} position={[(r.x + r.width / 2) * M, 0.004, (r.y + r.height / 2) * M]} receiveShadow>
          <planeGeometry args={[r.width * M, r.height * M]} />
          <meshStandardMaterial map={map} roughness={ROUGHNESS[kind]} />
        </mesh>
      ))}
    </>
  );
}

const wallMat = new THREE.MeshStandardMaterial({ color: "#f3f0ea", roughness: 0.92 });
const frameMat = new THREE.MeshStandardMaterial({ color: "#3b3f3d", roughness: 0.5, metalness: 0.3 });
const glassMat = new THREE.MeshPhysicalMaterial({ color: "#cfe3ea", roughness: 0.05, metalness: 0, transparent: true, opacity: 0.18, envMapIntensity: 1.5 });

function Walls({ plan }: { plan: FloorPlan }) {
  const parts = useMemo(() => {
    const t = WALL_THICKNESS;
    const out: { key: string; pos: [number, number, number]; size: [number, number, number]; mat: THREE.Material; shadow: boolean }[] = [];
    const box = (key: string, o: "horizontal" | "vertical", c: number, a: number, b: number, y0: number, y1: number, mat: THREE.Material, thick = t, shadow = true) => {
      const len = b - a, mid = (a + b) / 2, h = y1 - y0;
      out.push({
        key, mat, shadow,
        pos: o === "horizontal" ? [mid * M, (y0 + h / 2) * M, c * M] : [c * M, (y0 + h / 2) * M, mid * M],
        size: o === "horizontal" ? [len * M, h * M, thick * M] : [thick * M, h * M, len * M],
      });
    };
    const { solids, gaps } = wallPieces(plan);
    solids.forEach((s, i) => box(`w${i}`, s.orientation, s.c, s.a - (s.capA ? t / 2 : 0), s.b + (s.capB ? t / 2 : 0), 0, WALL_HEIGHT, wallMat));
    gaps.forEach((g, i) => {
      const { orientation: o, c } = g.seg;
      box(`l${i}`, o, c, g.a, g.b, DOOR_HEIGHT, WALL_HEIGHT, wallMat);
      if (g.kind === "window") {
        box(`s${i}`, o, c, g.a, g.b, 0, SILL_HEIGHT, wallMat);
        const f = 50;
        box(`fb${i}`, o, c, g.a, g.b, SILL_HEIGHT, SILL_HEIGHT + f, frameMat, 70);
        box(`ft${i}`, o, c, g.a, g.b, DOOR_HEIGHT - f, DOOR_HEIGHT, frameMat, 70);
        box(`fl${i}`, o, c, g.a, g.a + f, SILL_HEIGHT, DOOR_HEIGHT, frameMat, 70);
        box(`fr${i}`, o, c, g.b - f, g.b, SILL_HEIGHT, DOOR_HEIGHT, frameMat, 70);
        const mid = (g.a + g.b) / 2;
        if (g.b - g.a > 1100) box(`fm${i}`, o, c, mid - f / 2, mid + f / 2, SILL_HEIGHT, DOOR_HEIGHT, frameMat, 70);
        box(`g${i}`, o, c, g.a + f, g.b - f, SILL_HEIGHT + f, DOOR_HEIGHT - f, glassMat, 12, false);
      }
    });
    return out;
  }, [plan]);
  return (
    <>
      {parts.map((p) => (
        <mesh key={p.key} position={p.pos} material={p.mat} castShadow={p.shadow} receiveShadow>
          <boxGeometry args={p.size} />
        </mesh>
      ))}
    </>
  );
}

const doorMat = new THREE.MeshStandardMaterial({ color: "#e9e2d6", roughness: 0.6 });

function Doors({ plan }: { plan: FloorPlan }) {
  return (
    <>
      {plan.doors.map((d) => {
        // The leaf stands open at 90°, along the line the 2D plan draws for it
        const s = d.flip ? -1 : 1, w = d.width - 20, h = DOOR_HEIGHT - 10;
        const pos: [number, number, number] = d.orientation === "horizontal"
          ? [(d.x - d.width / 2 + 25) * M, (h / 2) * M, (d.y + (s * w) / 2) * M]
          : [(d.x + (s * w) / 2) * M, (h / 2) * M, (d.y - d.width / 2 + 25) * M];
        const size: [number, number, number] = d.orientation === "horizontal" ? [0.04, h * M, w * M] : [w * M, h * M, 0.04];
        return (
          <mesh key={d.id} position={pos} material={doorMat} castShadow receiveShadow>
            <boxGeometry args={size} />
          </mesh>
        );
      })}
    </>
  );
}

const ceilingMat = new THREE.MeshStandardMaterial({ color: "#fbfaf7", roughness: 0.95, side: THREE.DoubleSide });

function Ceilings({ plan }: { plan: FloorPlan }) {
  return (
    <>
      {plan.rooms.filter((r) => r.type !== "balcony").map((r) => (
        <mesh key={r.id} rotation-x={Math.PI / 2} position={[(r.x + r.width / 2) * M, WALL_HEIGHT * M, (r.y + r.height / 2) * M]} material={ceilingMat} castShadow receiveShadow>
          <planeGeometry args={[(r.width + WALL_THICKNESS) * M, (r.height + WALL_THICKNESS) * M]} />
        </mesh>
      ))}
    </>
  );
}

function RoomLights({ plan, strong }: { plan: FloorPlan; strong: boolean }) {
  return (
    <>
      {plan.rooms.filter((r) => r.type !== "balcony").map((r) => {
        const area = (r.width * r.height) / 1e6;
        return (
          <pointLight key={r.id} position={[(r.x + r.width / 2) * M, (WALL_HEIGHT - 300) * M, (r.y + r.height / 2) * M]}
            color="#ffd9a8" intensity={(strong ? 2.2 : 0.9) * Math.max(4, area)} distance={Math.max(r.width, r.height) * M * 1.6} decay={1.6} />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------------------------- furniture

const mat = (color: string, roughness = 0.7, metalness = 0, map?: THREE.Texture) =>
  new THREE.MeshStandardMaterial(map ? { color, roughness, metalness, map } : { color, roughness, metalness });

const MATS = {
  wood: mat("#a4784f", 0.55),
  darkWood: mat("#5e4632", 0.5),
  white: mat("#f5f4f0", 0.35),
  ceramic: mat("#fbfbfa", 0.12),
  steel: mat("#c9cdcf", 0.25, 0.85),
  black: mat("#2a2c2c", 0.4),
  counterTop: mat("#e6e2da", 0.25),
  cabinet: mat("#d8d3c8", 0.55),
  linen: mat("#f2efe8", 0.95, 0, fabricTexture()),
  duvet: mat("#b9c6c0", 0.95, 0, fabricTexture()),
  sofa: mat("#7f8f86", 0.95, 0, fabricTexture()),
  armchair: mat("#b08c66", 0.9, 0, fabricTexture()),
  rug: mat("#cbb894", 1, 0, fabricTexture()),
  pot: mat("#b5694a", 0.8),
  leaf: mat("#56794a", 0.8),
  glass: new THREE.MeshPhysicalMaterial({ color: "#dbe9ee", roughness: 0.05, transparent: true, opacity: 0.25 }),
  books: mat("#8a5a4a", 0.8),
};

/** A box positioned by its bottom-centre, in metres, in the item's local frame (back edge at -depth/2). */
function B({ x = 0, y = 0, z = 0, w, h, d, m, shadow = true }: { x?: number; y?: number; z?: number; w: number; h: number; d: number; m: THREE.Material; shadow?: boolean }) {
  return (
    <mesh position={[x, y + h / 2, z]} material={m} castShadow={shadow} receiveShadow>
      <boxGeometry args={[w, h, d]} />
    </mesh>
  );
}

function legs(w: number, d: number, h: number, m: THREE.Material, inset = 0.05, t = 0.045) {
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
    <B key={`leg${i}`} x={sx * (w / 2 - inset)} z={sz * (d / 2 - inset)} w={t} h={h} d={t} m={m} />
  ));
}

function FurnitureModel({ f }: { f: Furniture }) {
  const w = f.width * M, d = f.depth * M, H = FURNITURE_DEFAULTS[f.type].height * M;
  const back = -d / 2;
  let body: ReactNode;
  switch (f.type) {
    case "bed_double":
    case "bed_single": {
      const pillows = f.type === "bed_double" ? 2 : 1;
      const pw = (w - 0.16 - (pillows - 1) * 0.06) / pillows;
      body = (
        <>
          <B y={0.08} w={w} h={0.22} d={d} m={MATS.darkWood} />
          <B y={0.3} w={w - 0.04} h={0.22} d={d - 0.06} m={MATS.linen} />
          <B y={0.52} z={d * 0.12} w={w - 0.02} h={0.05} d={d * 0.68} m={MATS.duvet} />
          <B y={0} z={back + 0.04} w={w + 0.04} h={1.05} d={0.08} m={MATS.darkWood} />
          {Array.from({ length: pillows }, (_, i) => (
            <B key={i} x={-w / 2 + 0.08 + pw / 2 + i * (pw + 0.06)} y={0.52} z={back + 0.27} w={pw} h={0.12} d={0.36} m={MATS.white} />
          ))}
          {legs(w, d, 0.08, MATS.darkWood, 0.06)}
        </>
      );
      break;
    }
    case "sofa":
    case "armchair": {
      const m = f.type === "sofa" ? MATS.sofa : MATS.armchair;
      const arm = Math.min(0.18, w * 0.18);
      const seats = f.type === "sofa" ? Math.max(2, Math.round((w - 2 * arm) / 0.7)) : 1;
      const sw = (w - 2 * arm) / seats;
      body = (
        <>
          <B y={0.06} w={w} h={0.3} d={d} m={m} />
          <B y={0.06} z={back + 0.11} w={w} h={0.74} d={0.22} m={m} />
          <B y={0.06} x={-w / 2 + arm / 2} w={arm} h={0.56} d={d} m={m} />
          <B y={0.06} x={w / 2 - arm / 2} w={arm} h={0.56} d={d} m={m} />
          {Array.from({ length: seats }, (_, i) => (
            <B key={i} x={-w / 2 + arm + sw / 2 + i * sw} y={0.36} z={0.1} w={sw - 0.02} h={0.12} d={d - 0.26} m={m} />
          ))}
          {legs(w, d, 0.06, MATS.darkWood, 0.06, 0.04)}
        </>
      );
      break;
    }
    case "dining_table":
    case "coffee_table":
    case "desk":
      body = (
        <>
          <B y={H - 0.035} w={w} h={0.035} d={d} m={f.type === "desk" ? MATS.white : MATS.wood} />
          {legs(w, d, H - 0.035, f.type === "desk" ? MATS.black : MATS.wood)}
        </>
      );
      break;
    case "chair":
      body = (
        <>
          <B y={0.44} w={w} h={0.04} d={d} m={MATS.wood} />
          <B y={0.48} z={back + 0.02} w={w} h={0.4} d={0.035} m={MATS.wood} />
          {legs(w, d, 0.44, MATS.wood, 0.03, 0.035)}
        </>
      );
      break;
    case "wardrobe":
      body = (
        <>
          <B w={w} h={H} d={d} m={MATS.cabinet} />
          <B x={0} y={0.05} z={d / 2 + 0.003} w={0.006} h={H - 0.1} d={0.006} m={MATS.black} shadow={false} />
        </>
      );
      break;
    case "kitchen_counter":
      body = (
        <>
          <B w={w} h={H - 0.04} d={d - 0.02} m={MATS.cabinet} />
          <B y={H - 0.04} w={w} h={0.04} d={d} m={MATS.counterTop} />
          {w >= 1.6 && (
            <>
              <B x={-w / 2 + 0.55} y={H} w={0.6} h={0.01} d={0.4} m={MATS.steel} shadow={false} />
              <B x={w / 2 - 0.42} y={H} w={0.6} h={0.008} d={0.5} m={MATS.black} shadow={false} />
              {/* upper cabinets */}
              <B y={1.45} z={back + 0.17} w={w} h={0.7} d={0.34} m={MATS.cabinet} />
            </>
          )}
        </>
      );
      break;
    case "stove":
      body = (
        <>
          <B w={w} h={H - 0.03} d={d} m={MATS.white} />
          <B y={H - 0.03} w={w} h={0.03} d={d} m={MATS.black} />
        </>
      );
      break;
    case "sink":
      body = (
        <>
          <B w={w} h={H - 0.04} d={d} m={MATS.cabinet} />
          <B y={H - 0.04} w={w} h={0.04} d={d} m={MATS.steel} />
        </>
      );
      break;
    case "fridge":
      body = <B w={w} h={H} d={d} m={MATS.steel} />;
      break;
    case "washing_machine":
      body = (
        <>
          <B w={w} h={H} d={d} m={MATS.white} />
          <mesh position={[0, H * 0.45, d / 2 + 0.005]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[Math.min(w, H) * 0.3, Math.min(w, H) * 0.3, 0.02, 32]} />
            <primitive object={MATS.black} attach="material" />
          </mesh>
        </>
      );
      break;
    case "toilet":
      body = (
        <>
          <B z={back + 0.09} w={w} h={0.8} d={0.18} m={MATS.ceramic} />
          <B z={0.08} w={w * 0.85} h={0.4} d={d - 0.2} m={MATS.ceramic} />
        </>
      );
      break;
    case "washbasin":
      body = (
        <>
          <B y={0.45} w={w} h={0.4} d={d} m={MATS.wood} />
          <B y={0.85} w={w} h={0.06} d={d} m={MATS.ceramic} />
          <B y={1.1} z={back + 0.01} w={w * 0.8} h={0.7} d={0.02} m={MATS.steel} />
        </>
      );
      break;
    case "bathtub":
      body = <B w={w} h={H} d={d} m={MATS.ceramic} />;
      break;
    case "shower":
      body = (
        <>
          <B w={w} h={0.05} d={d} m={MATS.ceramic} />
          <B z={d / 2 - 0.01} w={w} h={2.0} d={0.01} m={MATS.glass} shadow={false} />
          <B x={-w / 2 + 0.01} w={0.01} h={2.0} d={d} m={MATS.glass} shadow={false} />
        </>
      );
      break;
    case "tv_unit":
      body = (
        <>
          <B w={w} h={H} d={d} m={MATS.wood} />
          <B y={H + 0.15} z={back + 0.06} w={Math.min(1.4, w * 0.8)} h={0.75} d={0.04} m={MATS.black} />
        </>
      );
      break;
    case "bookshelf":
      body = (
        <>
          <B w={w} h={H} d={d} m={MATS.wood} />
          {[0.35, 0.75, 1.15, 1.5].map((y) => <B key={y} y={y} z={0.02} w={w - 0.08} h={0.26} d={d - 0.08} m={MATS.books} />)}
        </>
      );
      break;
    case "plant": {
      const r = Math.min(w, d) / 2;
      body = (
        <>
          <mesh position={[0, 0.17, 0]} material={MATS.pot} castShadow receiveShadow>
            <cylinderGeometry args={[r * 0.55, r * 0.42, 0.34, 24]} />
          </mesh>
          {[[0, 0.75, 0, 1], [0.1, 0.95, 0.05, 0.75], [-0.08, 0.6, -0.06, 0.8]].map(([x, y, z, s], i) => (
            <mesh key={i} position={[x * r * 2, y, z * r * 2]} material={MATS.leaf} castShadow>
              <icosahedronGeometry args={[r * s, 1]} />
            </mesh>
          ))}
        </>
      );
      break;
    }
    case "rug":
      body = <B w={w} h={0.012} d={d} m={MATS.rug} shadow={false} />;
      break;
    default:
      body = <B w={w} h={H} d={d} m={MATS.white} />;
  }
  return (
    <group position={[f.x * M, 0.005, f.y * M]} rotation-y={(-f.rotation * Math.PI) / 180}>
      {body}
    </group>
  );
}
