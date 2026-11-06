import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  FURNITURE_DEFAULTS, WALL_THICKNESS, planBounds, transformRoom, roomArea, snap, snapToWall, uid, wallPieces,
  type Door, type FloorPlan, type Furniture, type FurnitureType, type Opening, type Room, type RoomType,
} from "../shared/plan";

export type Selection = { kind: "room" | "door" | "window" | "furniture"; id: string } | null;
export type Tool =
  | { kind: "select" }
  | { kind: "room" }
  | { kind: "door" }
  | { kind: "window" }
  | { kind: "furniture"; type: FurnitureType };

export const ROOM_FILL: Record<RoomType, string> = {
  living: "#f3e9d8", kitchen: "#efe3cf", dining: "#f1e6d2", bedroom: "#e4ebe2",
  bathroom: "#dfe9ee", hall: "#eeece6", balcony: "#e8eedd", office: "#ebe5ef",
  laundry: "#e1e8ec", storage: "#ebe8e1", other: "#efede8",
};

const INK = "#24302c";
const ACCENT = "#2f6b57";

interface Props {
  plan: FloorPlan;
  readOnly: boolean;
  selection: Selection;
  onSelect: (s: Selection) => void;
  tool: Tool;
  onToolDone: () => void;
  onChange: (plan: FloorPlan, mode: "commit" | "replace") => void;
  onCheckpoint: () => void;
  fitKey: number;
  svgRef: React.RefObject<SVGSVGElement | null>;
}

type Drag =
  | { mode: "pan"; sx: number; sy: number; vb: VB }
  | { mode: "move"; start: Pt; sel: NonNullable<Selection>; orig: FloorPlan; moved: boolean }
  | { mode: "resize"; corner: "nw" | "ne" | "sw" | "se"; id: string; orig: Room }
  | { mode: "draw"; start: Pt; cur: Pt };

type Pt = { x: number; y: number };
type VB = { x: number; y: number; w: number; h: number };

export default function PlanEditor2D(props: Props) {
  const { plan, readOnly, selection, onSelect, tool, onToolDone, onChange, onCheckpoint, fitKey, svgRef } = props;
  const [vb, setVb] = useState<VB>({ x: -1000, y: -1000, w: 12000, h: 9000 });
  const [px, setPx] = useState(10); // plan units per screen pixel
  const [hover, setHover] = useState<Pt | null>(null);
  const [drawRect, setDrawRect] = useState<{ a: Pt; b: Pt } | null>(null);
  const drag = useRef<Drag | null>(null);
  const planRef = useRef(plan);
  planRef.current = plan;

  const fit = useCallback(() => {
    const b = planBounds(planRef.current);
    const pad = 1500;
    setVb({ x: b.minX - pad, y: b.minY - pad, w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2 });
  }, []);
  useEffect(fit, [fitKey, fit]);

  // Track scale so handles/strokes keep a constant on-screen size
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const update = () => {
      const r = svg.getBoundingClientRect();
      if (r.width && r.height) setPx(Math.max(vb.w / r.width, vb.h / r.height));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(svg);
    return () => ro.disconnect();
  }, [vb, svgRef]);

  const toPlan = useCallback((clientX: number, clientY: number): Pt => {
    const svg = svgRef.current!;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }, [svgRef]);

  // Wheel zoom around the cursor (non-passive so we can prevent page scroll)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toPlan(e.clientX, e.clientY);
      const k = Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * 0.0015)));
      setVb((v) => {
        const w = Math.min(80000, Math.max(1500, v.w * k));
        const f = w / v.w;
        return { x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f, w, h: v.h * f };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [svgRef, toPlan]);

  const { solids } = useMemo(() => wallPieces(plan), [plan]);
  const bounds = useMemo(() => planBounds(plan), [plan]);

  // ---------------------------------------------------------------- pointer handling
  const startDrag = (e: RPointerEvent, d: Drag) => {
    drag.current = d;
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onBackgroundDown = (e: RPointerEvent) => {
    if (e.button === 1 || e.button === 2 || readOnly || tool.kind === "select") {
      if (tool.kind === "select" && e.button === 0) onSelect(null);
      startDrag(e, { mode: "pan", sx: e.clientX, sy: e.clientY, vb });
      return;
    }
    const p = toPlan(e.clientX, e.clientY);
    if (tool.kind === "room") {
      const s = { x: snap(p.x, 100), y: snap(p.y, 100) };
      setDrawRect({ a: s, b: s });
      startDrag(e, { mode: "draw", start: s, cur: s });
    } else if (tool.kind === "door" || tool.kind === "window") {
      placeOpening(tool.kind, p);
    } else if (tool.kind === "furniture") {
      const d = FURNITURE_DEFAULTS[tool.type];
      const item: Furniture = { id: uid("f"), type: tool.type, x: snap(p.x), y: snap(p.y), width: d.width, depth: d.depth, rotation: 0 };
      onChange({ ...plan, furniture: [...plan.furniture, item] }, "commit");
      onSelect({ kind: "furniture", id: item.id });
      onToolDone();
    }
  };

  const placeOpening = (kind: "door" | "window", p: Pt) => {
    const width = kind === "door" ? 850 : 1200;
    const hit = snapToWall(plan, p.x, p.y, width, 1200);
    if (!hit) return;
    const id = uid(kind === "door" ? "door" : "win");
    const base: Opening = { id, x: hit.x, y: hit.y, width, orientation: hit.orientation };
    if (kind === "door") onChange({ ...plan, doors: [...plan.doors, { ...base, flip: false }] }, "commit");
    else onChange({ ...plan, windows: [...plan.windows, base] }, "commit");
    onSelect({ kind, id });
    onToolDone();
  };

  const onItemDown = (e: RPointerEvent, sel: NonNullable<Selection>) => {
    if (readOnly || tool.kind !== "select" || e.button !== 0) return;
    e.stopPropagation();
    onSelect(sel);
    startDrag(e, { mode: "move", start: toPlan(e.clientX, e.clientY), sel, orig: plan, moved: false });
  };

  const onHandleDown = (e: RPointerEvent, room: Room, corner: "nw" | "ne" | "sw" | "se") => {
    e.stopPropagation();
    onCheckpoint();
    startDrag(e, { mode: "resize", corner, id: room.id, orig: room });
  };

  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current;
    const p = toPlan(e.clientX, e.clientY);
    if (tool.kind === "door" || tool.kind === "window") {
      const hit = snapToWall(plan, p.x, p.y, tool.kind === "door" ? 850 : 1200, 1200);
      setHover(hit ? { x: hit.x, y: hit.y } : null);
    } else if (hover) setHover(null);
    if (!d) return;

    if (d.mode === "pan") {
      const r = svgRef.current!.getBoundingClientRect();
      const k = Math.max(d.vb.w / r.width, d.vb.h / r.height);
      setVb({ ...d.vb, x: d.vb.x - (e.clientX - d.sx) * k, y: d.vb.y - (e.clientY - d.sy) * k });
      return;
    }
    if (d.mode === "draw") {
      const cur = { x: snap(p.x, 100), y: snap(p.y, 100) };
      d.cur = cur;
      setDrawRect({ a: d.start, b: cur });
      return;
    }
    if (d.mode === "resize") {
      const o = d.orig;
      let x1 = o.x, y1 = o.y, x2 = o.x + o.width, y2 = o.y + o.height;
      const sx = snap(p.x), sy = snap(p.y);
      if (d.corner.includes("w")) x1 = Math.min(sx, x2 - 600); else x2 = Math.max(sx, x1 + 600);
      if (d.corner.includes("n")) y1 = Math.min(sy, y2 - 600); else y2 = Math.max(sy, y1 + 600);
      onChange(transformRoom(planRef.current, d.id, { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }), "replace");
      return;
    }
    // move
    const dx = p.x - d.start.x, dy = p.y - d.start.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < px * 3) return;
      d.moved = true;
      onCheckpoint();
    }
    const o = d.orig;
    const { kind, id } = d.sel;
    if (kind === "room") {
      const room = o.rooms.find((r) => r.id === id)!;
      onChange(transformRoom(o, id, { x: snap(room.x + dx), y: snap(room.y + dy), width: room.width, height: room.height }), "replace");
    } else if (kind === "furniture") {
      onChange({ ...o, furniture: o.furniture.map((f) => (f.id === id ? { ...f, x: snap(f.x + dx, 25), y: snap(f.y + dy, 25) } : f)) }, "replace");
    } else {
      const list = kind === "door" ? o.doors : o.windows;
      const item = list.find((x) => x.id === id)!;
      const hit = snapToWall(o, p.x, p.y, item.width, 1500);
      if (!hit) return;
      const upd = <T extends Opening>(arr: T[]) => arr.map((x) => (x.id === id ? { ...x, x: hit.x, y: hit.y, orientation: hit.orientation } : x));
      onChange(kind === "door" ? { ...o, doors: upd(o.doors) } : { ...o, windows: upd(o.windows) }, "replace");
    }
  };

  const onPointerUp = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    svgRef.current?.releasePointerCapture?.(e.pointerId);
    if (d?.mode === "draw") {
      setDrawRect(null);
      const x = Math.min(d.start.x, d.cur.x), y = Math.min(d.start.y, d.cur.y);
      const w = Math.abs(d.cur.x - d.start.x), h = Math.abs(d.cur.y - d.start.y);
      if (w >= 600 && h >= 600) {
        const room: Room = { id: uid("room"), name: "Room", type: "other", x, y, width: w, height: h };
        onChange({ ...plan, rooms: [...plan.rooms, room] }, "commit");
        onSelect({ kind: "room", id: room.id });
      }
      onToolDone();
    }
  };

  // ---------------------------------------------------------------- render
  const isSel = (kind: string, id: string) => selection?.kind === kind && selection.id === id;
  const pad = 1600;
  const exportVb = `${bounds.minX - pad} ${bounds.minY - pad} ${bounds.maxX - bounds.minX + pad * 2} ${bounds.maxY - bounds.minY + pad * 2}`;
  const cursor = tool.kind === "select" ? (drag.current?.mode === "pan" ? "grabbing" : "default") : "crosshair";

  return (
    <svg
      ref={svgRef}
      className="plan-svg"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      data-export-viewbox={exportVb}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={onBackgroundDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onContextMenu={(e) => e.preventDefault()}
      style={{ cursor }}
      fontFamily="'Schibsted Grotesk', system-ui, sans-serif"
    >
      <defs data-editor-only>
        <pattern id="grid-minor" width="500" height="500" patternUnits="userSpaceOnUse">
          <path d="M 500 0 L 0 0 0 500" fill="none" stroke="#d9d4c7" strokeWidth={px * 0.6} />
        </pattern>
        <pattern id="grid" width="5000" height="5000" patternUnits="userSpaceOnUse">
          <rect width="5000" height="5000" fill="url(#grid-minor)" />
          <path d="M 5000 0 L 0 0 0 5000" fill="none" stroke="#c9c2b1" strokeWidth={px} />
        </pattern>
      </defs>
      <rect data-editor-only x={vb.x - vb.w} y={vb.y - vb.h} width={vb.w * 3} height={vb.h * 3} fill="url(#grid)" />

      {/* Rooms */}
      {plan.rooms.map((r) => (
        <rect
          key={r.id}
          x={r.x} y={r.y} width={r.width} height={r.height}
          fill={ROOM_FILL[r.type]}
          onPointerDown={(e) => onItemDown(e, { kind: "room", id: r.id })}
          style={{ cursor: readOnly || tool.kind !== "select" ? undefined : "move" }}
        />
      ))}

      {/* Furniture */}
      {plan.furniture.map((f) => (
        <g
          key={f.id}
          transform={`translate(${f.x} ${f.y}) rotate(${f.rotation})`}
          onPointerDown={(e) => onItemDown(e, { kind: "furniture", id: f.id })}
          style={{ cursor: readOnly || tool.kind !== "select" ? undefined : "move" }}
        >
          <FurnitureShape f={f} />
          {isSel("furniture", f.id) && (
            <rect data-editor-only x={-f.width / 2 - px * 4} y={-f.depth / 2 - px * 4} width={f.width + px * 8} height={f.depth + px * 8}
              fill="none" stroke={ACCENT} strokeWidth={px * 2} strokeDasharray={`${px * 6} ${px * 4}`} />
          )}
        </g>
      ))}

      {/* Walls */}
      <g pointerEvents="none">
        {solids.map((s, i) => {
          const t = WALL_THICKNESS / 2;
          const a = s.a - (s.capA ? t : 0), b = s.b + (s.capB ? t : 0);
          return s.orientation === "horizontal"
            ? <rect key={i} x={a} y={s.c - t} width={b - a} height={WALL_THICKNESS} fill={INK} />
            : <rect key={i} x={s.c - t} y={a} width={WALL_THICKNESS} height={b - a} fill={INK} />;
        })}
      </g>

      {/* Windows */}
      {plan.windows.map((w) => {
        const t = WALL_THICKNESS / 2;
        const horiz = w.orientation === "horizontal";
        const x = horiz ? w.x - w.width / 2 : w.x - t, y = horiz ? w.y - t : w.y - w.width / 2;
        const W = horiz ? w.width : WALL_THICKNESS, H = horiz ? WALL_THICKNESS : w.width;
        return (
          <g key={w.id} onPointerDown={(e) => onItemDown(e, { kind: "window", id: w.id })} style={{ cursor: readOnly ? undefined : "move" }}>
            <rect x={x} y={y} width={W} height={H} fill="#fbfaf6" stroke={isSel("window", w.id) ? ACCENT : INK} strokeWidth={isSel("window", w.id) ? 30 : 14} />
            {horiz
              ? <line x1={x} x2={x + W} y1={w.y} y2={w.y} stroke={INK} strokeWidth={10} />
              : <line y1={y} y2={y + H} x1={w.x} x2={w.x} stroke={INK} strokeWidth={10} />}
          </g>
        );
      })}

      {/* Doors */}
      {plan.doors.map((d) => (
        <DoorShape key={d.id} d={d} selected={isSel("door", d.id)} onPointerDown={(e) => onItemDown(e, { kind: "door", id: d.id })} readOnly={readOnly} />
      ))}

      {/* Room labels */}
      <g pointerEvents="none">
        {plan.rooms.map((r) => {
          const fs = Math.max(150, Math.min(240, Math.min(r.width, r.height) / 11));
          const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
          return (
            <g key={r.id}>
              <text x={cx} y={cy - fs * 0.25} textAnchor="middle" fontSize={fs} fontWeight={600} fill={INK}
                stroke={ROOM_FILL[r.type]} strokeWidth={fs * 0.35} strokeLinejoin="round" paintOrder="stroke">{r.name}</text>
              <text x={cx} y={cy + fs * 1.05} textAnchor="middle" fontSize={fs * 0.78} fill="#5b6661"
                stroke={ROOM_FILL[r.type]} strokeWidth={fs * 0.3} strokeLinejoin="round" paintOrder="stroke">{roomArea(r).toFixed(1)} m²</text>
            </g>
          );
        })}
      </g>

      {/* Overall dimensions */}
      {plan.rooms.length > 0 && <Dimensions b={bounds} />}

      {/* Selection outline + resize handles */}
      {!readOnly && selection?.kind === "room" && (() => {
        const r = plan.rooms.find((x) => x.id === selection.id);
        if (!r) return null;
        const hs = px * 10;
        const corners: ["nw" | "ne" | "sw" | "se", number, number][] = [
          ["nw", r.x, r.y], ["ne", r.x + r.width, r.y], ["sw", r.x, r.y + r.height], ["se", r.x + r.width, r.y + r.height],
        ];
        return (
          <g data-editor-only>
            <rect x={r.x} y={r.y} width={r.width} height={r.height} fill={ACCENT} fillOpacity={0.08} stroke={ACCENT} strokeWidth={px * 2} pointerEvents="none" />
            <text x={r.x + r.width / 2} y={r.y - px * 30} textAnchor="middle" fontSize={px * 12} fill={ACCENT} fontWeight={600} pointerEvents="none">
              {r.width} × {r.height} mm
            </text>
            {corners.map(([c, x, y]) => (
              <rect key={c} x={x - hs / 2} y={y - hs / 2} width={hs} height={hs} fill="#fff" stroke={ACCENT} strokeWidth={px * 2}
                style={{ cursor: c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize" }}
                onPointerDown={(e) => onHandleDown(e, r, c)} />
            ))}
          </g>
        );
      })()}

      {/* Tool previews */}
      {drawRect && (
        <rect data-editor-only
          x={Math.min(drawRect.a.x, drawRect.b.x)} y={Math.min(drawRect.a.y, drawRect.b.y)}
          width={Math.abs(drawRect.b.x - drawRect.a.x)} height={Math.abs(drawRect.b.y - drawRect.a.y)}
          fill={ACCENT} fillOpacity={0.12} stroke={ACCENT} strokeWidth={px * 2} strokeDasharray={`${px * 6} ${px * 4}`} />
      )}
      {hover && <circle data-editor-only cx={hover.x} cy={hover.y} r={px * 7} fill={ACCENT} pointerEvents="none" />}
    </svg>
  );
}

function DoorShape({ d, selected, onPointerDown, readOnly }: { d: Door; selected: boolean; onPointerDown: (e: RPointerEvent) => void; readOnly: boolean }) {
  const w = d.width;
  const s = d.flip ? -1 : 1;
  const stroke = selected ? ACCENT : INK;
  let leaf: string, arc: string, hit: { x: number; y: number; w: number; h: number };
  if (d.orientation === "horizontal") {
    const hx = d.x - w / 2;
    leaf = `M ${hx} ${d.y} L ${hx} ${d.y + s * w}`;
    arc = `M ${d.x + w / 2} ${d.y} A ${w} ${w} 0 0 ${s > 0 ? 1 : 0} ${hx} ${d.y + s * w}`;
    hit = { x: d.x - w / 2, y: Math.min(d.y, d.y + s * w), w, h: w };
  } else {
    const hy = d.y - w / 2;
    leaf = `M ${d.x} ${hy} L ${d.x + s * w} ${hy}`;
    arc = `M ${d.x} ${d.y + w / 2} A ${w} ${w} 0 0 ${s > 0 ? 0 : 1} ${d.x + s * w} ${hy}`;
    hit = { x: Math.min(d.x, d.x + s * w), y: d.y - w / 2, w, h: w };
  }
  return (
    <g onPointerDown={onPointerDown} style={{ cursor: readOnly ? undefined : "move" }}>
      <rect x={hit.x} y={hit.y} width={hit.w} height={hit.h} fill="transparent" />
      <path d={arc} fill="none" stroke={stroke} strokeWidth={selected ? 22 : 12} strokeDasharray="40 30" />
      <path d={leaf} fill="none" stroke={stroke} strokeWidth={selected ? 50 : 36} strokeLinecap="square" />
    </g>
  );
}

function Dimensions({ b }: { b: ReturnType<typeof planBounds> }) {
  const off = 700, tick = 120, fs = 180;
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  const y = b.minY - off, x = b.minX - off;
  return (
    <g stroke="#6b746f" strokeWidth={10} fill="#4a5450" fontSize={fs} fontFamily="'IBM Plex Mono', ui-monospace, monospace" pointerEvents="none">
      <line x1={b.minX} x2={b.maxX} y1={y} y2={y} />
      <line x1={b.minX} x2={b.minX} y1={y - tick} y2={y + tick} />
      <line x1={b.maxX} x2={b.maxX} y1={y - tick} y2={y + tick} />
      <text x={b.minX + w / 2} y={y - 70} textAnchor="middle" stroke="none">{w}</text>
      <line y1={b.minY} y2={b.maxY} x1={x} x2={x} />
      <line y1={b.minY} y2={b.minY} x1={x - tick} x2={x + tick} />
      <line y1={b.maxY} y2={b.maxY} x1={x - tick} x2={x + tick} />
      <text x={x - 70} y={b.minY + h / 2} textAnchor="middle" stroke="none" transform={`rotate(-90 ${x - 70} ${b.minY + h / 2})`}>{h}</text>
    </g>
  );
}

/** Furniture drawn in local coordinates: centred at 0,0, back edge at -depth/2 (north when rotation = 0). */
function FurnitureShape({ f }: { f: Furniture }) {
  const w = f.width, d = f.depth, x = -w / 2, y = -d / 2;
  const line = { fill: "none", stroke: "#56615c", strokeWidth: 12 } as const;
  const body = { fill: "#fdfcf8", stroke: "#56615c", strokeWidth: 16 } as const;
  switch (f.type) {
    case "bed_double":
    case "bed_single": {
      const pillows = f.type === "bed_double" ? 2 : 1;
      const pw = (w - 120 - (pillows - 1) * 60) / pillows;
      return (
        <g>
          <rect x={x} y={y} width={w} height={d} rx={40} {...body} />
          {Array.from({ length: pillows }, (_, i) => (
            <rect key={i} x={x + 60 + i * (pw + 60)} y={y + 70} width={pw} height={300} rx={60} {...line} />
          ))}
          <path d={`M ${x} ${y + 520} L ${x + w} ${y + 520}`} {...line} />
          <path d={`M ${x} ${y + 620} L ${x + w} ${y + 620}`} {...line} />
        </g>
      );
    }
    case "sofa":
    case "armchair":
      return (
        <g>
          <rect x={x} y={y} width={w} height={d} rx={90} {...body} />
          <rect x={x + 150} y={y + 230} width={w - 300} height={d - 280} rx={50} {...line} />
          {f.type === "sofa" && <path d={`M 0 ${y + 230} L 0 ${y + d - 50}`} {...line} />}
        </g>
      );
    case "dining_table":
    case "coffee_table":
    case "desk":
      return <rect x={x} y={y} width={w} height={d} rx={30} {...body} />;
    case "chair":
      return (
        <g>
          <rect x={x} y={y + 80} width={w} height={d - 80} rx={60} {...body} />
          <path d={`M ${x + 40} ${y + 60} L ${x + w - 40} ${y + 60}`} {...body} strokeWidth={50} strokeLinecap="round" />
        </g>
      );
    case "wardrobe":
      return (
        <g>
          <rect x={x} y={y} width={w} height={d} {...body} />
          <path d={`M ${x} ${y} L ${x + w} ${y + d} M ${x + w} ${y} L ${x} ${y + d}`} {...line} strokeWidth={8} />
        </g>
      );
    case "kitchen_counter":
      return (
        <g>
          <rect x={x} y={y} width={w} height={d} {...body} />
          {w >= 1600 && (
            <>
              <rect x={x + 150} y={y + 90} width={Math.min(700, w * 0.3)} height={d - 180} rx={50} {...line} />
              {[0, 1, 2, 3].map((i) => (
                <circle key={i} cx={x + w - 450 + (i % 2) * 260} cy={y + d / 2 - 130 + Math.floor(i / 2) * 260} r={90} {...line} />
              ))}
            </>
          )}
        </g>
      );
    case "stove":
      return (
        <g>
          <rect x={x} y={y} width={w} height={d} {...body} />
          {[0, 1, 2, 3].map((i) => (
            <circle key={i} cx={-w / 4 + (i % 2) * (w / 2)} cy={-d / 4 + Math.floor(i / 2) * (d / 2)} r={Math.min(w, d) / 6} {...line} />
          ))}
        </g>
      );
    case "sink":
    case "washbasin":
      return (
        <g>
          <rect x={x} y={y} width={w} height={d} rx={f.type === "washbasin" ? 80 : 20} {...body} />
          <ellipse cx={0} cy={40} rx={w / 2 - 110} ry={d / 2 - 110} {...line} />
        </g>
      );
    case "fridge":
      return (
        <g>
          <rect x={x} y={y} width={w} height={d} {...body} />
          <path d={`M ${x} ${y + d - 80} L ${x + w} ${y + d - 80}`} {...line} />
          <text x={0} y={60} textAnchor="middle" fontSize={160} fill="#56615c" fontWeight={600}>F</text>
        </g>
      );
    case "toilet":
      return (
        <g>
          <rect x={x} y={y} width={w} height={d * 0.32} rx={30} {...body} />
          <ellipse cx={0} cy={y + d * 0.32 + (d * 0.68) / 2} rx={w / 2 - 20} ry={(d * 0.68) / 2 - 10} {...body} />
        </g>
      );
    case "shower":
      return (
        <g>
          <rect x={x} y={y} width={w} height={d} {...body} />
          <path d={`M ${x} ${y} L ${x + w} ${y + d} M ${x + w} ${y} L ${x} ${y + d}`} {...line} strokeWidth={8} />
          <circle cx={0} cy={0} r={60} {...line} />
        </g>
      );
    case "bathtub":
      return (
        <g>
          <rect x={x} y={y} width={w} height={d} rx={60} {...body} />
          <rect x={x + 90} y={y + 90} width={w - 180} height={d - 180} rx={Math.min(w, d) / 3} {...line} />
        </g>
      );
    case "washing_machine":
      return (
        <g>
          <rect x={x} y={y} width={w} height={d} rx={30} {...body} />
          <circle cx={0} cy={30} r={Math.min(w, d) / 3} {...line} />
        </g>
      );
    case "tv_unit":
      return (
        <g>
          <rect x={x} y={y} width={w} height={d} {...body} />
          <path d={`M ${x + 120} ${y + 70} L ${x + w - 120} ${y + 70}`} {...body} strokeWidth={40} />
        </g>
      );
    case "bookshelf":
      return (
        <g>
          <rect x={x} y={y} width={w} height={d} {...body} />
          {(() => {
            const n = Math.max(1, Math.floor(w / 300));
            return Array.from({ length: n }, (_, i) => {
              const lx = x + ((i + 1) * w) / (n + 1);
              return <path key={i} d={`M ${lx} ${y} L ${lx} ${y + d}`} {...line} strokeWidth={8} />;
            });
          })()}
        </g>
      );
    case "plant":
      return (
        <g>
          <circle r={Math.min(w, d) / 2} fill="#dfe8d6" stroke="#6f8a62" strokeWidth={14} />
          {[0, 60, 120].map((a) => (
            <ellipse key={a} rx={Math.min(w, d) / 2.3} ry={Math.min(w, d) / 9} transform={`rotate(${a})`} fill="none" stroke="#6f8a62" strokeWidth={10} />
          ))}
        </g>
      );
    case "rug":
      return (
        <g>
          <rect x={x} y={y} width={w} height={d} rx={30} fill="#e9dfcd" fillOpacity={0.7} stroke="#b9a988" strokeWidth={10} />
          <rect x={x + 90} y={y + 90} width={w - 180} height={d - 180} rx={20} fill="none" stroke="#b9a988" strokeWidth={8} strokeDasharray="40 30" />
        </g>
      );
    default:
      return <rect x={x} y={y} width={w} height={d} {...body} />;
  }
}

