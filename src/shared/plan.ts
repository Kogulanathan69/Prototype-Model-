// Floor plan data model + geometry helpers, shared by the client and the server.
// Units: millimetres. Origin is the top-left corner; x grows right, y grows down.

export const ROOM_TYPES = [
  "living", "kitchen", "dining", "bedroom", "bathroom", "hall",
  "balcony", "office", "laundry", "storage", "other",
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export const FURNITURE_TYPES = [
  "bed_double", "bed_single", "sofa", "armchair", "dining_table", "coffee_table",
  "desk", "chair", "wardrobe", "kitchen_counter", "fridge", "stove", "sink",
  "toilet", "shower", "bathtub", "washbasin", "washing_machine", "tv_unit",
  "bookshelf", "plant", "rug",
] as const;
export type FurnitureType = (typeof FURNITURE_TYPES)[number];

export type Orientation = "horizontal" | "vertical";

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  x: number; // top-left
  y: number;
  width: number;
  height: number;
}

/** A door or window sitting on a wall. (x, y) is the centre of the opening. */
export interface Opening {
  id: string;
  x: number;
  y: number;
  width: number;
  orientation: Orientation; // orientation of the wall it sits in
}

export interface Door extends Opening {
  /** Mirror the swing to the other side of the wall. */
  flip: boolean;
}

export interface Furniture {
  id: string;
  type: FurnitureType;
  x: number; // centre
  y: number;
  width: number; // size before rotation
  depth: number;
  /**
   * Clockwise degrees: 0, 90, 180, 270. At 0 the item's back faces north (top of the plan) and its
   * front faces south, so a bed's headboard is at the top. 90 = back faces east, 180 = south, 270 = west.
   */
  rotation: number;
}

export interface FloorPlan {
  name: string;
  rooms: Room[];
  doors: Door[];
  windows: Opening[];
  furniture: Furniture[];
}

export const WALL_THICKNESS = 120;
export const WALL_HEIGHT = 2700;
export const DOOR_HEIGHT = 2100;
export const SILL_HEIGHT = 900;
export const SNAP = 50;

export const emptyPlan = (): FloorPlan => ({
  name: "Untitled plan",
  rooms: [],
  doors: [],
  windows: [],
  furniture: [],
});

export const FURNITURE_DEFAULTS: Record<FurnitureType, { label: string; width: number; depth: number; height: number }> = {
  bed_double: { label: "Double bed", width: 1600, depth: 2000, height: 500 },
  bed_single: { label: "Single bed", width: 900, depth: 2000, height: 500 },
  sofa: { label: "Sofa", width: 2100, depth: 900, height: 800 },
  armchair: { label: "Armchair", width: 850, depth: 850, height: 800 },
  dining_table: { label: "Dining table", width: 1600, depth: 900, height: 750 },
  coffee_table: { label: "Coffee table", width: 1100, depth: 600, height: 420 },
  desk: { label: "Desk", width: 1400, depth: 700, height: 750 },
  chair: { label: "Chair", width: 480, depth: 500, height: 850 },
  wardrobe: { label: "Wardrobe", width: 1800, depth: 600, height: 2100 },
  kitchen_counter: { label: "Kitchen counter", width: 2400, depth: 600, height: 900 },
  fridge: { label: "Fridge", width: 700, depth: 700, height: 1850 },
  stove: { label: "Stove", width: 600, depth: 600, height: 900 },
  sink: { label: "Sink", width: 800, depth: 600, height: 900 },
  toilet: { label: "Toilet", width: 400, depth: 650, height: 750 },
  shower: { label: "Shower", width: 900, depth: 900, height: 100 },
  bathtub: { label: "Bathtub", width: 1700, depth: 750, height: 550 },
  washbasin: { label: "Washbasin", width: 600, depth: 450, height: 850 },
  washing_machine: { label: "Washing machine", width: 600, depth: 600, height: 850 },
  tv_unit: { label: "TV unit", width: 1600, depth: 400, height: 500 },
  bookshelf: { label: "Bookshelf", width: 900, depth: 320, height: 1800 },
  plant: { label: "Plant", width: 450, depth: 450, height: 1100 },
  rug: { label: "Rug", width: 2000, depth: 1400, height: 10 },
};

export const ROOM_LABELS: Record<RoomType, string> = {
  living: "Living", kitchen: "Kitchen", dining: "Dining", bedroom: "Bedroom",
  bathroom: "Bathroom", hall: "Hall", balcony: "Balcony", office: "Office",
  laundry: "Laundry", storage: "Storage", other: "Room",
};

export const uid = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

export const snap = (v: number, step = SNAP) => Math.round(v / step) * step;

export const roomArea = (r: Room) => (r.width * r.height) / 1_000_000;

export const totalArea = (p: FloorPlan) => p.rooms.reduce((s, r) => s + roomArea(r), 0);

export function planBounds(p: FloorPlan) {
  if (!p.rooms.length) return { minX: 0, minY: 0, maxX: 8000, maxY: 6000 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of p.rooms) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { minX, minY, maxX, maxY };
}

/** Footprint of a furniture item after rotation (axis-aligned, since rotation is a multiple of 90). */
export function furnitureFootprint(f: Furniture) {
  const turned = Math.round(f.rotation / 90) % 2 !== 0;
  return turned ? { w: f.depth, d: f.width } : { w: f.width, d: f.depth };
}

// ---------------------------------------------------------------------------
// Walls: derived from room rectangle edges. Shared edges merge into one wall.

/** An axis-aligned wall centreline. Horizontal: y = c, x from a..b. Vertical: x = c, y from a..b. */
export interface WallSeg {
  orientation: Orientation;
  c: number;
  a: number;
  b: number;
}

function mergeIntervals(list: [number, number][]): [number, number][] {
  const sorted = [...list].sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function wallSegments(p: FloorPlan): WallSeg[] {
  const groups: Record<Orientation, Map<number, [number, number][]>> = {
    horizontal: new Map(),
    vertical: new Map(),
  };
  const add = (o: Orientation, c: number, a: number, b: number) => {
    const key = Math.round(c / 10) * 10;
    const g = groups[o];
    if (!g.has(key)) g.set(key, []);
    g.get(key)!.push([Math.min(a, b), Math.max(a, b)]);
  };
  for (const r of p.rooms) {
    add("horizontal", r.y, r.x, r.x + r.width);
    add("horizontal", r.y + r.height, r.x, r.x + r.width);
    add("vertical", r.x, r.y, r.y + r.height);
    add("vertical", r.x + r.width, r.y, r.y + r.height);
  }
  const segs: WallSeg[] = [];
  for (const o of ["horizontal", "vertical"] as const) {
    for (const [c, list] of groups[o]) {
      for (const [a, b] of mergeIntervals(list)) segs.push({ orientation: o, c, a, b });
    }
  }
  return segs;
}

const OPENING_TOLERANCE = 200;

/** Does this opening sit on this wall segment? */
export function openingOnSeg(o: Opening, s: WallSeg) {
  if (o.orientation !== s.orientation) return false;
  const c = o.orientation === "horizontal" ? o.y : o.x;
  const t = o.orientation === "horizontal" ? o.x : o.y;
  return Math.abs(c - s.c) <= OPENING_TOLERANCE && t + o.width / 2 > s.a && t - o.width / 2 < s.b;
}

/** A solid piece of wall. capA/capB: the end is a real wall end (extend it to close corners), not an opening edge. */
export interface WallPiece extends WallSeg {
  capA: boolean;
  capB: boolean;
}

/** Split walls around doors and windows. Returns solid wall pieces and the openings cut into them. */
export function wallPieces(p: FloorPlan) {
  const solids: WallPiece[] = [];
  const gaps: { seg: WallSeg; kind: "door" | "window"; a: number; b: number }[] = [];
  for (const s of wallSegments(p)) {
    const cuts: [number, number, "door" | "window"][] = [];
    for (const d of p.doors) if (openingOnSeg(d, s)) cuts.push(span(d, s, "door"));
    for (const w of p.windows) if (openingOnSeg(w, s)) cuts.push(span(w, s, "window"));
    cuts.sort((x, y) => x[0] - y[0]);
    let cursor = s.a;
    let capA = true;
    for (const [a, b, kind] of cuts) {
      if (a > cursor) solids.push({ ...s, a: cursor, b: a, capA, capB: false });
      gaps.push({ seg: s, kind, a, b });
      cursor = Math.max(cursor, b);
      capA = false;
    }
    if (cursor < s.b) solids.push({ ...s, a: cursor, b: s.b, capA, capB: true });
  }
  return { solids, gaps };
}

function span(o: Opening, s: WallSeg, kind: "door" | "window"): [number, number, "door" | "window"] {
  const t = o.orientation === "horizontal" ? o.x : o.y;
  return [Math.max(s.a, t - o.width / 2), Math.min(s.b, t + o.width / 2), kind];
}

/**
 * Move or resize a room. Doors and windows on its edges move with their edge, and are clamped to stay
 * within it, so they don't get left floating. On a pure move, furniture inside the room moves too.
 */
export function transformRoom(p: FloorPlan, roomId: string, next: { x: number; y: number; width: number; height: number }): FloorPlan {
  const old = p.rooms.find((r) => r.id === roomId);
  if (!old) return p;
  const dx = next.x - old.x, dy = next.y - old.y;
  const pureMove = next.width === old.width && next.height === old.height;
  const tol = 5;

  const follow = <T extends Opening>(o: T): T => {
    if (o.orientation === "horizontal") {
      if (o.x < old.x - tol || o.x > old.x + old.width + tol) return o;
      let y: number;
      if (Math.abs(o.y - old.y) <= tol) y = next.y;
      else if (Math.abs(o.y - (old.y + old.height)) <= tol) y = next.y + next.height;
      else return o;
      const x = pureMove ? o.x + dx : clampAlong(o.x, o.width, next.x, next.x + next.width);
      return { ...o, x, y };
    }
    if (o.y < old.y - tol || o.y > old.y + old.height + tol) return o;
    let x: number;
    if (Math.abs(o.x - old.x) <= tol) x = next.x;
    else if (Math.abs(o.x - (old.x + old.width)) <= tol) x = next.x + next.width;
    else return o;
    const y = pureMove ? o.y + dy : clampAlong(o.y, o.width, next.y, next.y + next.height);
    return { ...o, x, y };
  };

  const inside = (f: Furniture) => f.x > old.x && f.x < old.x + old.width && f.y > old.y && f.y < old.y + old.height;
  return {
    ...p,
    rooms: p.rooms.map((r) => (r.id === roomId ? { ...r, ...next } : r)),
    doors: p.doors.map(follow),
    windows: p.windows.map(follow),
    furniture: pureMove ? p.furniture.map((f) => (inside(f) ? { ...f, x: f.x + dx, y: f.y + dy } : f)) : p.furniture,
  };
}

function clampAlong(t: number, width: number, a: number, b: number) {
  const margin = width / 2 + 100;
  if (b - a < 2 * margin) return (a + b) / 2;
  return Math.min(Math.max(t, a + margin), b - margin);
}

/** Problems worth flagging in the editor: overlapping rooms and openings or furniture that lost their place. */
export function checkPlan(p: FloorPlan): string[] {
  const issues: string[] = [];
  const name = (r: Room) => r.name || ROOM_LABELS[r.type];
  for (let i = 0; i < p.rooms.length; i++)
    for (let j = i + 1; j < p.rooms.length; j++) {
      const a = p.rooms[i], b = p.rooms[j];
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (ox > 1 && oy > 1) issues.push(`${name(a)} overlaps ${name(b)}`);
    }
  const segs = wallSegments(p);
  const onWall = (o: Opening) => segs.some((s) => openingOnSeg(o, s));
  const loose = (list: Opening[], what: string) => {
    const n = list.filter((o) => !onWall(o)).length;
    if (n) issues.push(`${n} ${what}${n > 1 ? "s are" : " is"} not on a wall`);
  };
  loose(p.doors, "door");
  loose(p.windows, "window");
  const outside = p.furniture.filter((f) => {
    const { w, d } = furnitureFootprint(f);
    return !p.rooms.some((r) => f.x - w / 2 >= r.x - 1 && f.x + w / 2 <= r.x + r.width + 1 && f.y - d / 2 >= r.y - 1 && f.y + d / 2 <= r.y + r.height + 1);
  }).length;
  if (outside) issues.push(`${outside} furniture item${outside > 1 ? "s stick" : " sticks"} out of a room`);
  return issues;
}

/** Find the closest wall to a point and project the point onto it. */
export function snapToWall(p: FloorPlan, x: number, y: number, width: number, maxDist = 600) {
  let best: { x: number; y: number; orientation: Orientation; dist: number } | null = null;
  for (const s of wallSegments(p)) {
    const len = s.b - s.a;
    if (len < width) continue;
    const half = width / 2;
    if (s.orientation === "horizontal") {
      const t = Math.min(Math.max(x, s.a + half), s.b - half);
      const dist = Math.hypot(x - t, y - s.c);
      if (!best || dist < best.dist) best = { x: snap(t, 10), y: s.c, orientation: "horizontal", dist };
    } else {
      const t = Math.min(Math.max(y, s.a + half), s.b - half);
      const dist = Math.hypot(x - s.c, y - t);
      if (!best || dist < best.dist) best = { x: s.c, y: snap(t, 10), orientation: "vertical", dist };
    }
  }
  return best && best.dist <= maxDist ? best : null;
}

/** Light sanitising for plans that come from the model or from an imported file. */
export function normalizePlan(raw: unknown): FloorPlan {
  const p = (raw ?? {}) as Partial<FloorPlan>;
  const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : d);
  const seen = new Set<string>();
  const id = (v: unknown, prefix: string) => {
    let s = typeof v === "string" && v ? v : uid(prefix);
    while (seen.has(s)) s = uid(prefix);
    seen.add(s);
    return s;
  };
  const orient = (v: unknown): Orientation => (v === "vertical" ? "vertical" : "horizontal");
  return {
    name: typeof p.name === "string" && p.name ? p.name : "Untitled plan",
    rooms: (Array.isArray(p.rooms) ? p.rooms : [])
      .map((r) => ({
        id: id(r.id, "room"),
        name: String(r.name ?? ROOM_LABELS[r.type as RoomType] ?? "Room"),
        type: (ROOM_TYPES as readonly string[]).includes(r.type) ? r.type : "other",
        x: num(r.x),
        y: num(r.y),
        width: Math.max(300, num(r.width, 3000)),
        height: Math.max(300, num(r.height, 3000)),
      })),
    doors: (Array.isArray(p.doors) ? p.doors : []).map((d) => ({
      id: id(d.id, "door"),
      x: num(d.x),
      y: num(d.y),
      width: Math.max(500, num(d.width, 850)),
      orientation: orient(d.orientation),
      flip: Boolean(d.flip),
    })),
    windows: (Array.isArray(p.windows) ? p.windows : []).map((w) => ({
      id: id(w.id, "win"),
      x: num(w.x),
      y: num(w.y),
      width: Math.max(300, num(w.width, 1200)),
      orientation: orient(w.orientation),
    })),
    furniture: (Array.isArray(p.furniture) ? p.furniture : [])
      .filter((f) => (FURNITURE_TYPES as readonly string[]).includes(f.type))
      .map((f) => ({
        id: id(f.id, "f"),
        type: f.type,
        x: num(f.x),
        y: num(f.y),
        width: Math.max(100, num(f.width, FURNITURE_DEFAULTS[f.type].width)),
        depth: Math.max(100, num(f.depth, FURNITURE_DEFAULTS[f.type].depth)),
        rotation: ((Math.round(num(f.rotation) / 90) * 90) % 360 + 360) % 360,
      })),
  };
}

// Chat wire types
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ChatRequest {
  history: ChatTurn[];
  message: string;
  plan: FloorPlan;
  image?: { mediaType: string; data: string }; // base64, no data: prefix
}

export interface ChatResponse {
  reply: string;
  plan: FloorPlan | null;
  mode: "claude" | "demo";
}
