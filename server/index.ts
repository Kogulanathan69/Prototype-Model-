import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { normalizePlan, type ChatRequest } from "../src/shared/plan.ts";
import { hasClaude, runAgent } from "./agent.ts";
import { demoAgent } from "./demo.ts";
import { ImageAIError, enhanceRender, hasImageAI, type EnhanceRequest } from "./imageEnhance.ts";

const app = express();
app.use(express.json({ limit: "12mb" }));

app.get("/api/status", (_req, res) => {
  res.json({
    mode: hasClaude() ? "claude" : "demo",
    model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
    imageEnhance: hasImageAI(),
  });
});

app.post("/api/render/enhance", async (req, res) => {
  const b = req.body as Partial<EnhanceRequest>;
  const valid =
    typeof b.image === "string" && b.image.length > 100 &&
    (b.mediaType === "image/png" || b.mediaType === "image/jpeg" || b.mediaType === "image/webp") &&
    (b.style === "photoreal" || b.style === "watercolor" || b.style === "sketch") &&
    Number.isFinite(b.width) && Number.isFinite(b.height) && (b.width as number) > 0 && (b.height as number) > 0;
  if (!valid) {
    res.status(400).json({ error: "image, mediaType, width, height and style are required" });
    return;
  }
  try {
    const out = await enhanceRender({ ...(b as EnhanceRequest), description: String(b.description ?? "a residential interior") });
    res.json(out);
  } catch (err) {
    if (err instanceof ImageAIError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "AI enhance failed unexpectedly." });
  }
});

app.post("/api/chat", async (req, res) => {
  const body = req.body as Partial<ChatRequest>;
  if (typeof body.message !== "string" || !body.message.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  const chat: ChatRequest = {
    message: body.message.slice(0, 8000),
    history: Array.isArray(body.history)
      ? body.history.filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.text === "string")
      : [],
    plan: normalizePlan(body.plan),
    image:
      body.image && typeof body.image.data === "string" && /^image\/(png|jpeg|gif|webp)$/.test(body.image.mediaType)
        ? body.image
        : undefined,
  };

  if (!hasClaude()) {
    res.json(demoAgent(chat));
    return;
  }
  try {
    res.json(await runAgent(chat));
  } catch (err) {
    console.error(err);
    let message = "The design agent hit an error. Please try again.";
    if (err instanceof Anthropic.AuthenticationError) message = "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.";
    else if (err instanceof Anthropic.RateLimitError) message = "Rate limited by the Anthropic API. Wait a moment and try again.";
    else if (err instanceof Anthropic.APIConnectionError) message = "Couldn't reach the Anthropic API. Check your connection.";
    else if (err instanceof Anthropic.APIError) message = `Anthropic API error ${err.status}: ${err.message}`;
    res.status(502).json({ error: message });
  }
});

// Serve the built client in production
if (process.env.NODE_ENV === "production") {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`Roomwright API on http://localhost:${port} (${hasClaude() ? "Claude" : "offline demo"} mode, AI enhance ${hasImageAI() ? "on" : "off"})`);
});
