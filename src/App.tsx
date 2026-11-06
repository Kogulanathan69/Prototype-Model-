import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Chat from "./components/Chat";
import Inspector from "./components/Inspector";
import PlanEditor2D, { type Selection, type Tool } from "./components/PlanEditor2D";
import type { RenderItem } from "./components/RenderStudio";
import { exportJson, exportPng, exportSvg } from "./lib/export";
import { useHistory } from "./lib/history";
import { loadCurrentId, loadProjects, newProject, saveCurrentId, saveProjects, type ChatMessage, type Project } from "./lib/projects";
import { normalizePlan, uid, type ChatRequest, type ChatResponse, type FloorPlan } from "./shared/plan";

const Plan3D = lazy(() => import("./components/Plan3D"));
const RenderStudio = lazy(() => import("./components/RenderStudio"));

function initialProjects(): { list: Project[]; current: Project } {
  const list = loadProjects();
  const id = loadCurrentId();
  const current = list.find((p) => p.id === id) ?? list[0] ?? newProject();
  return { list: list.includes(current) ? list : [current, ...list], current };
}

export default function App() {
  const init = useMemo(initialProjects, []);
  const [projects, setProjects] = useState<Project[]>(init.list);
  const [projectId, setProjectId] = useState(init.current.id);
  const history = useHistory<FloorPlan>(init.current.plan);
  const [messages, setMessages] = useState<ChatMessage[]>(init.current.messages);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"claude" | "demo" | null>(null);
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [selection, setSelectionState] = useState<Selection>(null);
  // Mirror selection in a ref that updates synchronously, so keyboard shortcuts fired right after a click
  // act on what was just selected rather than on the previous render's value.
  const selectionRef = useRef<Selection>(null);
  const setSelection = useCallback((s: Selection) => {
    selectionRef.current = s;
    setSelectionState(s);
  }, []);
  const [tool, setTool] = useState<Tool>({ kind: "select" });
  const [fitKey, setFitKey] = useState(0);
  const [menu, setMenu] = useState(false);
  const [studio, setStudio] = useState(false);
  const [imageAI, setImageAI] = useState(false);
  // Renders are kept for the session, per project (they're large, so not saved to browser storage)
  const [renders, setRenders] = useState<Record<string, RenderItem[]>>({});
  const svgRef = useRef<SVGSVGElement | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const plan = history.value;
  const preview = previewId ? messages.find((m) => m.id === previewId)?.proposal ?? null : null;
  const shown = preview ?? plan;
  const readOnly = Boolean(preview);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then((s) => { setMode(s.mode); setImageAI(Boolean(s.imageEnhance)); }).catch(() => setMode(null));
  }, []);

  // Persist the current project
  useEffect(() => {
    setProjects((list) => {
      const next = list.map((p) => (p.id === projectId ? { ...p, plan, messages, updatedAt: Date.now() } : p));
      saveProjects(next);
      return next;
    });
    saveCurrentId(projectId);
  }, [plan, messages, projectId]);

  const switchProject = (p: Project) => {
    setProjectId(p.id);
    history.reset(p.plan);
    setMessages(p.messages);
    setPreviewId(null);
    setSelection(null);
    setTool({ kind: "select" });
    setFitKey((k) => k + 1);
  };

  const createProject = () => {
    const p = newProject();
    setProjects((list) => [p, ...list]);
    switchProject(p);
  };

  const deleteProject = () => {
    if (!confirm(`Delete “${plan.name}”? This can't be undone.`)) return;
    const rest = projects.filter((p) => p.id !== projectId);
    const next = rest[0] ?? newProject();
    setProjects(rest.length ? rest : [next]);
    switchProject(next);
  };

  // ------------------------------------------------------------ chat
  const send = async (text: string, image?: { mediaType: string; data: string; url: string }) => {
    const userMsg: ChatMessage = { id: uid("m"), role: "user", text, imageUrl: image?.url };
    const prior = messages;
    setMessages((m) => [...m, userMsg]);
    setBusy(true);
    setPreviewId(null);
    try {
      const body: ChatRequest = {
        history: prior.filter((m) => !m.error).map((m) => ({
          role: m.role,
          text: m.proposal ? `${m.text}\n[Proposed plan "${m.proposal.name}" was ${m.status === "accepted" ? "accepted" : m.status === "rejected" ? "discarded" : "not yet accepted"} by the user.]` : m.text,
        })),
        message: text,
        plan,
        image: image ? { mediaType: image.mediaType, data: image.data } : undefined,
      };
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json()) as ChatResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      if (data.mode) setMode(data.mode);
      const reply: ChatMessage = {
        id: uid("m"),
        role: "assistant",
        text: data.reply,
        proposal: data.plan ? normalizePlan(data.plan) : undefined,
        status: data.plan ? "pending" : undefined,
      };
      setMessages((m) => [
        ...m.map((x) => (x.status === "pending" ? { ...x, status: "rejected" as const } : x)),
        reply,
      ]);
      if (reply.proposal) {
        setPreviewId(reply.id);
        setSelection(null);
        setFitKey((k) => k + 1);
      }
    } catch (err) {
      setMessages((m) => [...m, { id: uid("m"), role: "assistant", text: err instanceof Error ? err.message : "Something went wrong.", error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const accept = (id: string) => {
    const msg = messages.find((m) => m.id === id);
    if (!msg?.proposal) return;
    history.commit(msg.proposal);
    setMessages((m) => m.map((x) => (x.id === id ? { ...x, status: "accepted" } : x.status === "pending" ? { ...x, status: "rejected" } : x)));
    setPreviewId(null);
    setFitKey((k) => k + 1);
  };

  const reject = (id: string) => {
    setMessages((m) => m.map((x) => (x.id === id ? { ...x, status: "rejected" } : x)));
    if (previewId === id) setPreviewId(null);
    setFitKey((k) => k + 1);
  };

  // ------------------------------------------------------------ editing
  const onChange = useCallback((p: FloorPlan, how: "commit" | "replace") => (how === "commit" ? history.commit(p) : history.replace(p)), [history]);

  const deleteSelection = useCallback(() => {
    const selection = selectionRef.current;
    if (!selection || readOnly) return;
    const { kind, id } = selection;
    const p = history.get();
    history.commit({
      ...p,
      rooms: kind === "room" ? p.rooms.filter((r) => r.id !== id) : p.rooms,
      doors: kind === "door" ? p.doors.filter((d) => d.id !== id) : p.doors,
      windows: kind === "window" ? p.windows.filter((w) => w.id !== id) : p.windows,
      furniture: kind === "furniture" ? p.furniture.filter((f) => f.id !== id) : p.furniture,
    });
    setSelection(null);
  }, [readOnly, history, setSelection]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [role=dialog]") || document.querySelector(".studio-backdrop")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) history.redo(); else history.undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); history.redo(); return; }
      if (mod) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelection(); }
      else if (e.key === "Escape") { setSelection(null); setTool({ kind: "select" }); }
      else if (readOnly) return;
      else if (e.key === "v") setTool({ kind: "select" });
      else if (e.key === "d") setTool({ kind: "door" });
      else if (e.key === "w") setTool({ kind: "window" });
      else if (e.key === "r") {
        const selection = selectionRef.current;
        if (selection?.kind === "furniture") {
          const p = history.get();
          history.commit({ ...p, furniture: p.furniture.map((f) => (f.id === selection.id ? { ...f, rotation: (f.rotation + 90) % 360 } : f)) });
        } else setTool({ kind: "room" });
      } else if (e.key === "f" && selectionRef.current?.kind === "door") {
        const id = selectionRef.current.id;
        const p = history.get();
        history.commit({ ...p, doors: p.doors.map((d) => (d.id === id ? { ...d, flip: !d.flip } : d)) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history, deleteSelection, readOnly, setSelection]);

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const p = normalizePlan(JSON.parse(await file.text()));
      history.commit(p);
      setPreviewId(null);
      setFitKey((k) => k + 1);
    } catch {
      alert("That file isn't a valid floor plan JSON.");
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden><rect x="3" y="3" width="26" height="26" rx="3" fill="none" stroke="currentColor" strokeWidth="3" /><path d="M3 16h14V3" fill="none" stroke="currentColor" strokeWidth="3" /></svg>
          Roomwright
        </div>
        <input className="plan-name" value={plan.name} onChange={(e) => history.replace({ ...plan, name: e.target.value })} aria-label="Plan name" />
        <select className="project-select" value={projectId} onChange={(e) => { const p = projects.find((x) => x.id === e.target.value); if (p) switchProject(p); }} aria-label="Projects">
          {projects.map((p) => <option key={p.id} value={p.id}>{p.id === projectId ? plan.name : p.plan.name}</option>)}
        </select>
        <button className="btn" onClick={createProject}>New</button>
        <div className="spacer" />
        <div className="seg">
          <button className={view === "2d" ? "active" : ""} onClick={() => setView("2d")}>2D</button>
          <button className={view === "3d" ? "active" : ""} onClick={() => setView("3d")}>3D</button>
        </div>
        <button className="btn btn-render" onClick={() => setStudio(true)} disabled={shown.rooms.length === 0} title="Photoreal, watercolor and sketch renders">
          Render
        </button>
        <button className="icon-btn" onClick={history.undo} disabled={!history.canUndo || readOnly} title="Undo (Ctrl+Z)">↶</button>
        <button className="icon-btn" onClick={history.redo} disabled={!history.canRedo || readOnly} title="Redo (Ctrl+Y)">↷</button>
        <button className="btn" onClick={() => setFitKey((k) => k + 1)}>Fit</button>
        <div className="menu-wrap">
          <button className="btn" onClick={() => setMenu((m) => !m)}>Export ▾</button>
          {menu && (
            <div className="menu" onMouseLeave={() => setMenu(false)}>
              <button onClick={() => { svgRef.current && exportPng(svgRef.current, shown); setMenu(false); }}>PNG image</button>
              <button onClick={() => { svgRef.current && exportSvg(svgRef.current, shown); setMenu(false); }}>SVG drawing</button>
              <button onClick={() => { exportJson(shown); setMenu(false); }}>JSON data</button>
              <hr />
              <button onClick={() => { importRef.current?.click(); setMenu(false); }}>Import JSON…</button>
              <button className="danger" onClick={() => { setMenu(false); deleteProject(); }}>Delete project</button>
            </div>
          )}
          <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
      </header>

      <main className="workspace">
        <Chat messages={messages} busy={busy} mode={mode} onSend={send} onAccept={accept} onReject={reject}
          onPreview={(id) => { setPreviewId(id); setFitKey((k) => k + 1); }} previewId={previewId} />

        <section className="canvas-wrap">
          {preview && (
            <div className="preview-banner">
              <span><strong>Previewing a proposal.</strong> Accept it to start editing.</span>
              <button className="btn btn-primary" onClick={() => accept(previewId!)}>Accept</button>
              <button className="btn" onClick={() => reject(previewId!)}>Discard</button>
            </div>
          )}
          <div className={`canvas ${view === "3d" ? "hidden" : ""}`}>
            <PlanEditor2D plan={shown} readOnly={readOnly} selection={readOnly ? null : selection} onSelect={setSelection}
              tool={readOnly ? { kind: "select" } : tool} onToolDone={() => setTool({ kind: "select" })}
              onChange={onChange} onCheckpoint={history.checkpoint} fitKey={fitKey} svgRef={svgRef} />
            {shown.rooms.length === 0 && !busy && (
              <div className="canvas-empty">
                <p>Your plan will appear here.</p>
                <p className="muted">Describe it in the chat, or draw rooms yourself with the Room tool (R).</p>
              </div>
            )}
            <div className="scale-note">Units: mm · grid 500 mm</div>
          </div>
          {view === "3d" && (
            <Suspense fallback={<div className="canvas-empty"><p>Loading 3D…</p></div>}>
              <Plan3D plan={shown} />
            </Suspense>
          )}
        </section>

        <Inspector plan={shown} selection={readOnly ? null : selection} readOnly={readOnly} tool={tool} setTool={setTool}
          onChange={(p) => history.commit(p)} onDelete={deleteSelection} />
      </main>

      {studio && (
        <Suspense fallback={<div className="studio-backdrop"><div className="canvas-empty"><p>Loading renderer…</p></div></div>}>
          <RenderStudio
            plan={shown}
            renders={renders[projectId] ?? []}
            onAdd={(r) => setRenders((all) => ({ ...all, [projectId]: [r, ...(all[projectId] ?? [])] }))}
            onRemove={(id) => setRenders((all) => ({ ...all, [projectId]: (all[projectId] ?? []).filter((r) => r.id !== id) }))}
            aiEnabled={imageAI}
            onClose={() => setStudio(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
