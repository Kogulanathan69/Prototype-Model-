import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { EffectComposer, Kuwahara, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { sketch, toUploadJpeg, watercolor } from "../lib/stylize";
import { uid, type FloorPlan } from "../shared/plan";
import RenderScene, { sceneBounds, type Lighting } from "./RenderScene";

export type RenderStyle = "photoreal" | "watercolor" | "sketch";

export interface RenderItem {
  id: string;
  url: string; // data URL (PNG)
  style: RenderStyle;
  label: string; // human description of the view
  enhanced: boolean;
  createdAt: number;
}

const STYLES: { id: RenderStyle; label: string }[] = [
  { id: "photoreal", label: "Photoreal" },
  { id: "watercolor", label: "Watercolor" },
  { id: "sketch", label: "Sketch" },
];
const LIGHTS: { id: Lighting; label: string }[] = [
  { id: "day", label: "Daylight" },
  { id: "golden", label: "Golden hour" },
  { id: "evening", label: "Evening" },
];

const M = 1 / 1000;

interface Props {
  plan: FloorPlan;
  renders: RenderItem[];
  onAdd: (r: RenderItem) => void;
  onRemove: (id: string) => void;
  aiEnabled: boolean;
  onClose: () => void;
}

export default function RenderStudio({ plan, renders, onAdd, onRemove, aiEnabled, onClose }: Props) {
  const [style, setStyle] = useState<RenderStyle>("photoreal");
  const [view, setView] = useState<string>("bird"); // "bird" | "top" | room id (eye level)
  const [lighting, setLighting] = useState<Lighting>("day");
  const [ceilingPref, setCeilingPref] = useState<boolean | null>(null);
  const [dpr, setDpr] = useState(1.25);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<RenderItem | null>(null);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);

  const eyeRooms = plan.rooms.filter((r) => r.type !== "balcony" && r.width >= 1500 && r.height >= 1500);
  const eyeRoom = plan.rooms.find((r) => r.id === view);
  const ceiling = ceilingPref ?? Boolean(eyeRoom);
  const viewLabel = view === "bird" ? "Bird's-eye view" : view === "top" ? "Top-down view" : `Eye-level view of the ${eyeRoom?.name ?? "room"}`;

  // Fall back to bird's-eye if the chosen room disappears
  useEffect(() => {
    if (view !== "bird" && view !== "top" && !eyeRoom) setView("bird");
  }, [view, eyeRoom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (viewer) setViewer(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer, onClose]);

  const frames = (n: number) => new Promise<void>((resolve) => {
    const step = (i: number) => (i <= 0 ? resolve() : requestAnimationFrame(() => step(i - 1)));
    step(n);
  });

  const render = async () => {
    if (!glRef.current || busy) return;
    setError(null);
    setBusy("Rendering at high resolution…");
    try {
      const prev = dpr;
      setDpr(Math.min(2.5, (window.devicePixelRatio || 1) * 2));
      await frames(8);
      let url = glRef.current.domElement.toDataURL("image/png");
      setDpr(prev);
      if (style === "watercolor") {
        setBusy("Applying watercolor washes…");
        url = await watercolor(url);
      } else if (style === "sketch") {
        setBusy("Drawing pencil lines…");
        url = await sketch(url);
      }
      const item: RenderItem = { id: uid("render"), url, style, label: `${viewLabel} · ${LIGHTS.find((l) => l.id === lighting)!.label}`, enhanced: false, createdAt: Date.now() };
      onAdd(item);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rendering failed.");
    } finally {
      setBusy(null);
    }
  };

  const enhance = async (item: RenderItem) => {
    if (busy) return;
    setError(null);
    setBusy("AI enhance in progress. This can take up to a minute…");
    try {
      const img = await toUploadJpeg(item.url);
      const res = await fetch("/api/render/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: img.data,
          mediaType: img.mediaType,
          width: img.width,
          height: img.height,
          style: item.style,
          description: `${item.label.split(" · ")[0].toLowerCase()} of a ${plan.name.toLowerCase()} with ${plan.rooms.map((r) => r.name.toLowerCase()).join(", ")}`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `AI enhance failed (${res.status})`);
      onAdd({ ...item, id: uid("render"), url: `data:${data.mediaType};base64,${data.data}`, enhanced: true, createdAt: Date.now() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI enhance failed.");
    } finally {
      setBusy(null);
    }
  };

  const download = (item: RenderItem) => {
    const a = document.createElement("a");
    a.href = item.url;
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    a.download = `${slug(plan.name)}-${slug(item.label)}-${item.style}${item.enhanced ? "-ai" : ""}.png`;
    a.click();
  };

  return (
    <div className="studio-backdrop" role="dialog" aria-modal="true" aria-label="Render studio">
      <div className="studio">
        <header className="studio-head">
          <h2>Rendered views</h2>
          <span className="studio-sub">{plan.name}</span>
          <button className="icon-btn studio-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="studio-body">
          <div className="studio-preview">
            {plan.rooms.length === 0 ? (
              <div className="canvas-empty"><p>Nothing to render yet.</p><p className="muted">Create or accept a plan first.</p></div>
            ) : (
              <Canvas
                key={plan.rooms.length === 0 ? "empty" : "scene"}
                shadows
                flat
                dpr={dpr}
                gl={{ preserveDrawingBuffer: true, antialias: false, powerPreference: "high-performance" }}
                camera={{ fov: 40, near: 0.05, far: 500 }}
                onCreated={({ gl }) => { glRef.current = gl; }}
              >
                <RenderScene plan={plan} lighting={lighting} ceiling={ceiling} />
                <CameraRig plan={plan} view={view} />
                <Effects style={style} />
              </Canvas>
            )}
            <div className="studio-hint">
              {eyeRoom ? "Drag to look around" : "Drag to orbit · scroll to zoom · right-drag to pan"}
              {style !== "photoreal" && " · paper & linework are added when you render"}
            </div>
            {busy && <div className="studio-busy"><div className="typing"><span /><span /><span /></div>{busy}</div>}
          </div>

          <aside className="studio-controls">
            <div className="field">
              <span>Style</span>
              <div className="seg seg-full">
                {STYLES.map((s) => <button key={s.id} className={style === s.id ? "active" : ""} onClick={() => setStyle(s.id)}>{s.label}</button>)}
              </div>
            </div>
            <label className="field">
              <span>Camera</span>
              <select value={view} onChange={(e) => setView(e.target.value)}>
                <option value="bird">Bird's-eye</option>
                <option value="top">Top-down</option>
                {eyeRooms.length > 0 && (
                  <optgroup label="Eye level">
                    {eyeRooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </optgroup>
                )}
              </select>
            </label>
            <div className="field">
              <span>Lighting</span>
              <div className="seg seg-full">
                {LIGHTS.map((l) => <button key={l.id} className={lighting === l.id ? "active" : ""} onClick={() => setLighting(l.id)}>{l.label}</button>)}
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={ceiling} onChange={(e) => setCeilingPref(e.target.checked)} />
              Ceilings
            </label>
            <button className="btn btn-primary studio-render" onClick={render} disabled={Boolean(busy) || plan.rooms.length === 0}>
              Render image
            </button>
            <p className="hint">
              Renders run in your browser and match the plan exactly.{" "}
              {aiEnabled
                ? "Use AI enhance on a render for a photographic finish."
                : "AI enhance is off. Set OPENAI_API_KEY in .env to turn it on."}
            </p>
            {error && <p className="studio-error" role="alert">{error}</p>}
          </aside>
        </div>

        <section className="gallery" aria-label="Rendered images">
          {renders.length === 0 ? (
            <p className="hint">Your renders will appear here.</p>
          ) : (
            renders.map((r) => (
              <figure key={r.id} className="shot">
                <button className="shot-img" onClick={() => setViewer(r)} aria-label={`Open ${r.label}`}>
                  <img src={r.url} alt={r.label} />
                  {r.enhanced && <span className="badge">AI</span>}
                </button>
                <figcaption>
                  <span className="shot-label">{STYLES.find((s) => s.id === r.style)!.label} · {r.label}</span>
                  <span className="shot-actions">
                    <button className="btn btn-ghost" onClick={() => download(r)}>Download</button>
                    {!r.enhanced && (
                      <button className="btn btn-ghost" onClick={() => enhance(r)} disabled={!aiEnabled || Boolean(busy)}
                        title={aiEnabled ? "Send to the image AI for a photographic finish" : "Set OPENAI_API_KEY in .env to enable"}>
                        AI enhance
                      </button>
                    )}
                    <button className="btn btn-ghost" onClick={() => onRemove(r.id)} aria-label="Delete render">Delete</button>
                  </span>
                </figcaption>
              </figure>
            ))
          )}
        </section>

        {viewer && (
          <div className="viewer" onClick={() => setViewer(null)}>
            <img src={viewer.url} alt={viewer.label} />
            <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
              <span>{viewer.label}{viewer.enhanced ? " · AI enhanced" : ""}</span>
              <button className="btn" onClick={() => download(viewer)}>Download</button>
              <button className="btn" onClick={() => setViewer(null)}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Effects({ style }: { style: RenderStyle }) {
  const ao = <N8AO quality="high" aoRadius={0.6} distanceFalloff={0.5} intensity={style === "photoreal" ? 2.4 : 1.6} />;
  const tone = <ToneMapping mode={ToneMappingMode.AGX} />;
  if (style === "photoreal")
    return (
      <EffectComposer key="photoreal" multisampling={0}>
        {ao}
        {tone}
        <SMAA />
        <Vignette offset={0.3} darkness={0.42} />
      </EffectComposer>
    );
  if (style === "watercolor")
    return (
      <EffectComposer key="watercolor" multisampling={0}>
        {ao}
        {tone}
        <Kuwahara radius={6} sectorCount={8} />
      </EffectComposer>
    );
  return (
    <EffectComposer key="sketch" multisampling={0}>
      {ao}
      {tone}
      <SMAA />
    </EffectComposer>
  );
}

/** Positions the camera for the selected view and configures orbit / look-around controls. */
function CameraRig({ plan, view }: { plan: FloorPlan; view: string }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useRef<OrbitControlsImpl | null>(null);
  const eye = view !== "bird" && view !== "top";

  const shot = useMemo(() => {
    const { center, size } = sceneBounds(plan);
    if (view === "bird") {
      return { pos: new THREE.Vector3(center.x + size * 0.8, size * 1.45, center.z + size * 1.15), target: center.clone(), fov: 34 };
    }
    if (view === "top") {
      return { pos: new THREE.Vector3(center.x, size * 2.1, center.z + 0.001), target: center.clone(), fov: 32 };
    }
    const r = plan.rooms.find((x) => x.id === view);
    if (!r) return { pos: new THREE.Vector3(center.x + size, size, center.z + size), target: center.clone(), fov: 38 };
    // Stand in a corner near the room's door (but outside its swing) and look toward the opposite corner
    const inset = 350;
    const corners = [
      [r.x + inset, r.y + inset], [r.x + r.width - inset, r.y + inset],
      [r.x + inset, r.y + r.height - inset], [r.x + r.width - inset, r.y + r.height - inset],
    ];
    const onEdge = (d: { x: number; y: number }) =>
      (Math.abs(d.y - r.y) < 10 || Math.abs(d.y - r.y - r.height) < 10) && d.x >= r.x && d.x <= r.x + r.width ||
      (Math.abs(d.x - r.x) < 10 || Math.abs(d.x - r.x - r.width) < 10) && d.y >= r.y && d.y <= r.y + r.height;
    const door = plan.doors.find(onEdge);
    let ci = 3;
    if (door) {
      const clear = door.width + 450; // keep clear of the open leaf
      let best = Infinity;
      corners.forEach(([x, y], i) => {
        const dist = Math.hypot(x - door.x, y - door.y);
        const score = dist < clear ? dist + 1e6 : dist; // prefer the nearest corner that's outside the swing
        if (score < best) { best = score; ci = i; }
      });
    }
    const [cx, cy] = corners[ci];
    const [tx, ty] = corners[3 - ci];
    return { pos: new THREE.Vector3(cx * M, 1.5, cy * M), target: new THREE.Vector3(tx * M, 0.95, ty * M), fov: 72 };
  }, [plan, view]);

  useEffect(() => {
    camera.fov = shot.fov;
    camera.position.copy(shot.pos);
    camera.lookAt(shot.target);
    camera.updateProjectionMatrix();
    const c = controls.current;
    if (c) {
      // Eye level: orbit around a point just in front of the lens, which feels like turning your head.
      const t = eye ? shot.pos.clone().add(shot.target.clone().sub(shot.pos).normalize().multiplyScalar(0.05)) : shot.target;
      c.target.copy(t);
      c.update();
    }
  }, [shot, camera, eye]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      enableZoom={!eye}
      enablePan={!eye}
      rotateSpeed={eye ? -0.35 : 0.8}
      maxPolarAngle={eye ? Math.PI * 0.85 : Math.PI / 2.05}
      minPolarAngle={eye ? Math.PI * 0.15 : 0}
    />
  );
}
