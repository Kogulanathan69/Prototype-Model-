// Optional "AI enhance" for renders: sends a rendered view to OpenAI's image edit endpoint and asks for a
// photograph-like (or painted) version that keeps the same layout and camera. Enabled only when
// OPENAI_API_KEY is set. (Claude reads images but doesn't generate them, so this step uses an image model.)

export type RenderStyle = "photoreal" | "watercolor" | "sketch";

export const hasImageAI = () => Boolean(process.env.OPENAI_API_KEY);

const STYLE_PROMPT: Record<RenderStyle, string> = {
  photoreal:
    "a professional, photorealistic architectural interior photograph: natural daylight, realistic materials (wood grain, fabric, ceramic, painted plaster), soft shadows, subtle reflections, correct perspective, high dynamic range, magazine quality",
  watercolor:
    "an architectural watercolor illustration on textured cold-press paper: loose transparent washes, soft pigment blooms, fine ink linework for walls and furniture, warm natural light",
  sketch:
    "an architect's hand-drawn pencil and ink sketch on off-white paper: confident linework, light hatching for shadows, minimal muted color accents",
};

export interface EnhanceRequest {
  image: string; // base64, no data: prefix
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  style: RenderStyle;
  description: string; // e.g. "eye-level view of the Primary bedroom in a 2-bedroom apartment"
}

export function buildPrompt(req: EnhanceRequest) {
  return (
    `Re-render this 3D visualisation as ${STYLE_PROMPT[req.style]}. ` +
    `Scene: ${req.description.slice(0, 300)}. ` +
    "Keep the exact camera angle, room layout, wall and window positions, door openings, and the position, size and type of every piece of furniture. " +
    "Do not add or remove rooms, walls, windows or furniture. Do not add text, labels, people or watermarks."
  );
}

function sizeFor(w: number, h: number) {
  const r = w / h;
  if (r > 1.2) return "1536x1024";
  if (r < 0.83) return "1024x1536";
  return "1024x1024";
}

export class ImageAIError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function enhanceRender(req: EnhanceRequest): Promise<{ data: string; mediaType: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new ImageAIError("AI enhance isn't configured. Set OPENAI_API_KEY in .env.", 501);
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

  const form = new FormData();
  form.append("model", process.env.OPENAI_IMAGE_MODEL || "gpt-image-1");
  form.append("prompt", buildPrompt(req));
  form.append("size", sizeFor(req.width, req.height));
  form.append("quality", process.env.OPENAI_IMAGE_QUALITY || "medium");
  form.append("n", "1");
  const ext = req.mediaType.split("/")[1];
  form.append("image", new Blob([Buffer.from(req.image, "base64")], { type: req.mediaType }), `render.${ext}`);

  let res: Response;
  try {
    res = await fetch(`${base}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
  } catch (err) {
    throw new ImageAIError(`Couldn't reach the image API (${err instanceof Error ? err.message : "network error"}).`, 502);
  }
  const body = (await res.json().catch(() => null)) as { data?: { b64_json?: string }[]; error?: { message?: string } } | null;
  if (!res.ok) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) throw new ImageAIError("The image API key was rejected. Check OPENAI_API_KEY in .env.", 502);
    if (res.status === 429) throw new ImageAIError("The image API is rate-limiting or out of credit. Try again later.", 502);
    throw new ImageAIError(`Image API error: ${msg}`, 502);
  }
  const b64 = body?.data?.[0]?.b64_json;
  if (!b64) throw new ImageAIError("The image API returned no image.", 502);
  return { data: b64, mediaType: "image/png" };
}
