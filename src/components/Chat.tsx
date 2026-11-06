import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../lib/projects";
import { totalArea } from "../shared/plan";

const EXAMPLES = [
  "Two bedrooms, an open kitchen facing the balcony, and a bathroom with laundry off the hall.",
  "A compact studio around 35 m² with a sleeping nook and a full bathroom.",
  "Three-bedroom family apartment with a home office and two bathrooms.",
];

interface Props {
  messages: ChatMessage[];
  busy: boolean;
  mode: "claude" | "demo" | null;
  onSend: (text: string, image?: { mediaType: string; data: string; url: string }) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onPreview: (id: string) => void;
  previewId: string | null;
}

export default function Chat({ messages, busy, mode, onSend, onAccept, onReject, onPreview, previewId }: Props) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ mediaType: string; data: string; url: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy]);

  const send = (value = text) => {
    const v = value.trim();
    if (!v || busy) return;
    onSend(v, image ?? undefined);
    setText("");
    setImage(null);
  };

  const pickImage = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return alert("Use a PNG, JPEG, GIF or WebP image.");
    if (file.size > 8 * 1024 * 1024) return alert("Images must be under 8 MB.");
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      setImage({ mediaType: file.type, data: url.split(",")[1], url });
    };
    reader.readAsDataURL(file);
  };

  return (
    <aside className="chat">
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <h2>Describe the space you want.</h2>
            <p>Name the rooms, the rough size and anything that matters to you, like light, flow or storage. You can also attach a sketch or an existing plan.</p>
            <div className="examples">
              {EXAMPLES.map((e) => (
                <button key={e} className="example" onClick={() => send(e)} disabled={busy}>{e}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}${m.error ? " msg-error" : ""}`}>
            {m.imageUrl && <img className="msg-image" src={m.imageUrl} alt="Reference" />}
            <div className="msg-text">{m.text}</div>
            {m.proposal && (
              <div className={`proposal proposal-${m.status}`}>
                <div className="proposal-head">
                  <strong>{m.proposal.name}</strong>
                  <span>{m.proposal.rooms.length} rooms · {totalArea(m.proposal).toFixed(1)} m²</span>
                </div>
                {m.status === "pending" ? (
                  <div className="proposal-actions">
                    <button className="btn btn-primary" onClick={() => onAccept(m.id)}>Accept plan</button>
                    <button className="btn" onClick={() => onReject(m.id)}>Discard</button>
                    {previewId !== m.id && <button className="btn btn-ghost" onClick={() => onPreview(m.id)}>Preview</button>}
                  </div>
                ) : (
                  <div className="proposal-status">{m.status === "accepted" ? "Accepted" : "Discarded"}</div>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="msg msg-assistant">
            <div className="typing"><span /><span /><span /></div>
            <div className="msg-sub">Drafting the layout…</div>
          </div>
        )}
      </div>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        {image && (
          <div className="attachment">
            <img src={image.url} alt="" />
            <span>Reference image</span>
            <button type="button" className="icon-btn" onClick={() => setImage(null)} aria-label="Remove image">×</button>
          </div>
        )}
        <textarea
          value={text}
          placeholder={messages.length ? "Ask for a change, e.g. “make the kitchen bigger”" : "Two bedrooms, an open kitchen…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          onPaste={(e) => {
            const f = [...e.clipboardData.files].find((x) => x.type.startsWith("image/"));
            if (f) pickImage(f);
          }}
          rows={3}
        />
        <div className="composer-bar">
          <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()} title="Attach a reference image">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.5 12.5 21a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6L16 7.1" /></svg>
            Image
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ""; }} />
          <span className="mode-pill" title={mode === "demo" ? "No ANTHROPIC_API_KEY set on the server" : undefined}>
            {mode === "claude" ? "Claude" : mode === "demo" ? "Offline demo" : "…"}
          </span>
          <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>Send</button>
        </div>
      </form>
    </aside>
  );
}
