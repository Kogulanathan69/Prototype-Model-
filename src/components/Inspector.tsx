import {
  FURNITURE_DEFAULTS, FURNITURE_TYPES, ROOM_LABELS, ROOM_TYPES, checkPlan, furnitureFootprint, roomArea, totalArea, transformRoom,
  type FloorPlan, type FurnitureType,
} from "../shared/plan";
import type { Selection, Tool } from "./PlanEditor2D";

interface Props {
  plan: FloorPlan;
  selection: Selection;
  readOnly: boolean;
  tool: Tool;
  setTool: (t: Tool) => void;
  onChange: (plan: FloorPlan) => void;
  onDelete: () => void;
}

export default function Inspector({ plan, selection, readOnly, tool, setTool, onChange, onDelete }: Props) {
  const room = selection?.kind === "room" ? plan.rooms.find((r) => r.id === selection.id) : undefined;
  const door = selection?.kind === "door" ? plan.doors.find((d) => d.id === selection.id) : undefined;
  const win = selection?.kind === "window" ? plan.windows.find((w) => w.id === selection.id) : undefined;
  const item = selection?.kind === "furniture" ? plan.furniture.find((f) => f.id === selection.id) : undefined;

  const num = (v: string, min = 0) => Math.max(min, Math.round(Number(v) || 0));
  const issues = checkPlan(plan);

  return (
    <aside className="inspector">
      <section>
        <h3>Tools</h3>
        <div className="tool-grid">
          {([
            ["select", "Select", "V"],
            ["room", "Room", "R"],
            ["door", "Door", "D"],
            ["window", "Window", "W"],
          ] as const).map(([k, label, key]) => (
            <button key={k} disabled={readOnly && k !== "select"} className={`tool ${tool.kind === k ? "active" : ""}`} onClick={() => setTool({ kind: k })} title={`${label} (${key})`}>
              {label}
            </button>
          ))}
        </div>
        <p className="hint">
          {tool.kind === "room" && "Drag on the canvas to draw a room."}
          {(tool.kind === "door" || tool.kind === "window") && `Click a wall to place a ${tool.kind}.`}
          {tool.kind === "furniture" && `Click to place a ${FURNITURE_DEFAULTS[tool.type].label.toLowerCase()}.`}
          {tool.kind === "select" && "Drag items to move them. Drag the empty canvas to pan, and scroll to zoom."}
        </p>
        <label className="field">
          <span>Add furniture</span>
          <select
            disabled={readOnly}
            value={tool.kind === "furniture" ? tool.type : ""}
            onChange={(e) => e.target.value && setTool({ kind: "furniture", type: e.target.value as FurnitureType })}
          >
            <option value="">Choose an item…</option>
            {FURNITURE_TYPES.map((t) => <option key={t} value={t}>{FURNITURE_DEFAULTS[t].label}</option>)}
          </select>
        </label>
      </section>

      {room && (
        <section>
          <h3>Room</h3>
          <label className="field"><span>Name</span>
            <input value={room.name} disabled={readOnly} onChange={(e) => onChange(updRoom(plan, room.id, { name: e.target.value }))} />
          </label>
          <label className="field"><span>Type</span>
            <select value={room.type} disabled={readOnly} onChange={(e) => onChange(updRoom(plan, room.id, { type: e.target.value as typeof room.type }))}>
              {ROOM_TYPES.map((t) => <option key={t} value={t}>{ROOM_LABELS[t]}</option>)}
            </select>
          </label>
          <div className="row2">
            <label className="field"><span>Width (mm)</span>
              <input type="number" step={50} value={room.width} disabled={readOnly} onChange={(e) => onChange(transformRoom(plan, room.id, { x: room.x, y: room.y, width: num(e.target.value, 300), height: room.height }))} />
            </label>
            <label className="field"><span>Depth (mm)</span>
              <input type="number" step={50} value={room.height} disabled={readOnly} onChange={(e) => onChange(transformRoom(plan, room.id, { x: room.x, y: room.y, width: room.width, height: num(e.target.value, 300) }))} />
            </label>
          </div>
          <div className="stat">{roomArea(room).toFixed(2)} m²</div>
        </section>
      )}

      {(door || win) && (
        <section>
          <h3>{door ? "Door" : "Window"}</h3>
          <label className="field"><span>Width (mm)</span>
            <input type="number" step={50} value={(door ?? win)!.width} disabled={readOnly}
              onChange={(e) => {
                const width = num(e.target.value, 300);
                onChange(door
                  ? { ...plan, doors: plan.doors.map((d) => (d.id === door.id ? { ...d, width } : d)) }
                  : { ...plan, windows: plan.windows.map((w) => (w.id === win!.id ? { ...w, width } : w)) });
              }} />
          </label>
          {door && (
            <button className="btn" disabled={readOnly} onClick={() => onChange({ ...plan, doors: plan.doors.map((d) => (d.id === door.id ? { ...d, flip: !d.flip } : d)) })}>
              Flip swing (F)
            </button>
          )}
          <p className="hint">Drag it along any wall to move it.</p>
        </section>
      )}

      {item && (
        <section>
          <h3>{FURNITURE_DEFAULTS[item.type].label}</h3>
          <div className="row2">
            <label className="field"><span>Width (mm)</span>
              <input type="number" step={50} value={item.width} disabled={readOnly} onChange={(e) => onChange(updItem(plan, item.id, { width: num(e.target.value, 100) }))} />
            </label>
            <label className="field"><span>Depth (mm)</span>
              <input type="number" step={50} value={item.depth} disabled={readOnly} onChange={(e) => onChange(updItem(plan, item.id, { depth: num(e.target.value, 100) }))} />
            </label>
          </div>
          <button className="btn" disabled={readOnly} onClick={() => onChange(updItem(plan, item.id, { rotation: (item.rotation + 90) % 360 }))}>
            Rotate 90° (R)
          </button>
          <div className="stat">Footprint {furnitureFootprint(item).w} × {furnitureFootprint(item).d} mm</div>
        </section>
      )}

      {issues.length > 0 && (
        <section className="plan-check" role="status">
          <h3>Plan check</h3>
          <ul>{issues.map((i) => <li key={i}>{i}</li>)}</ul>
        </section>
      )}

      {selection && !readOnly && (
        <section>
          <button className="btn btn-danger" onClick={onDelete}>Delete (Del)</button>
        </section>
      )}

      {!selection && (
        <section>
          <h3>Plan</h3>
          <dl className="summary">
            <dt>Rooms</dt><dd>{plan.rooms.length}</dd>
            <dt>Total area</dt><dd>{totalArea(plan).toFixed(1)} m²</dd>
            <dt>Doors</dt><dd>{plan.doors.length}</dd>
            <dt>Windows</dt><dd>{plan.windows.length}</dd>
            <dt>Furniture</dt><dd>{plan.furniture.length}</dd>
          </dl>
          {plan.rooms.length > 0 && (
            <ul className="room-list">
              {plan.rooms.map((r) => (
                <li key={r.id}><span>{r.name}</span><span>{roomArea(r).toFixed(1)} m²</span></li>
              ))}
            </ul>
          )}
        </section>
      )}
    </aside>
  );
}

const updRoom = (p: FloorPlan, id: string, patch: Partial<FloorPlan["rooms"][number]>) => ({
  ...p, rooms: p.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)),
});
const updItem = (p: FloorPlan, id: string, patch: Partial<FloorPlan["furniture"][number]>) => ({
  ...p, furniture: p.furniture.map((f) => (f.id === id ? { ...f, ...patch } : f)),
});
