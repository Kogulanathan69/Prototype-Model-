import Anthropic from "@anthropic-ai/sdk";
import { normalizePlan, type ChatRequest, type ChatResponse } from "../src/shared/plan.ts";
import { agentOutputSchema } from "./schema.ts";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const EFFORT = (process.env.CLAUDE_EFFORT || "medium") as "low" | "medium" | "high" | "xhigh" | "max";

const SYSTEM = `You are Roomwright, a friendly spatial-design agent that drafts residential floor plans.

Every reply is JSON with two fields:
- "reply": what you say to the user. Plain prose, short (2-6 sentences). When you propose a plan, summarise the layout and the key decisions, and end by asking them to accept it or request changes. Never paste JSON or coordinates into the reply.
- "plan": either the COMPLETE new floor plan (when the user asks for a new plan or any change to the current one), or null (when they only ask a question, or you need to ask a clarifying question first). Only ask clarifying questions when the request is truly too vague to draw; otherwise make sensible assumptions and say what you assumed.

Coordinate system and conventions:
- Units are millimetres, as integers. Origin (0,0) is the top-left of the plan; x grows to the right, y grows downward. Treat the top of the plan as north.
- Rooms are axis-aligned rectangles (x, y = top-left corner). Rooms must tile cleanly: adjacent rooms share edges exactly (same coordinate), and rooms never overlap. An L-shaped space is two rectangles with the same name and type.
- Walls are generated automatically from room edges. Do not output walls.
- Doors and windows sit ON a room edge. (x, y) is the centre of the opening. "orientation" is the orientation of the wall it sits in: "horizontal" means it lies on a top or bottom edge (y equals that edge's y), "vertical" means a left or right edge (x equals that edge's x). Keep the whole opening within the wall segment and at least 100 mm from corners.
- Every room except balconies, and except open-plan spaces that are connected along a shared wall by a wide door, needs at least one door. Interior doors are 800-900 mm wide; the entrance door is 900-1000 mm and sits on an exterior edge, usually into a hall. Use a 1600-2400 mm door for a balcony slider or a wide opening between living and dining.
- Windows go only on exterior edges (edges not shared with another room). Living rooms and bedrooms get at least one window, 1000-2400 mm wide. Bathrooms get a small one (600 mm) if they touch an exterior edge.
- Furniture: (x, y) is the CENTRE; width and depth are the unrotated size; rotation is clockwise degrees 0, 90, 180 or 270 (90 and 270 swap the footprint). At rotation 0 the item's BACK faces north (up) and its front faces south. So, for an item against the north wall use 0, the east wall 90, the south wall 180, the west wall 270. A bed's back is its headboard; a chair's back faces away from the table or desk it serves. Place furniture fully inside its room, keep 700-900 mm walkways, keep it out of door swings, and put beds, wardrobes, counters and sofas against walls. Furnish every room sensibly: beds and wardrobes in bedrooms; a sofa, coffee table and TV unit in living rooms; a counter, fridge, stove and sink in kitchens; a dining table with chairs; a toilet, washbasin and shower or bathtub in bathrooms; a washing machine in the laundry.
- Realistic sizes: bedroom 9-16 m², primary bedroom 12-18 m², bathroom 4-8 m², corridor width 1100-1500 mm, typical apartment 40-120 m².
- Keep the ids of existing elements stable when editing, and keep everything the user did not ask to change. Use short ids such as "room_living" or "door_bath".
- If the user attaches a reference image (a sketch or an existing plan), follow its layout and proportions.
- The user may have edited the plan by hand since your last turn. The current plan they send is the source of truth.`;

let client: Anthropic | null = null;
export const hasClaude = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export async function runAgent(req: ChatRequest): Promise<ChatResponse> {
  client ??= new Anthropic();

  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const turn of req.history.slice(-16)) {
    // Keep the transcript well-formed: alternate roles and merge consecutive same-role turns.
    const last = messages[messages.length - 1];
    if (last && last.role === turn.role && typeof last.content === "string") {
      last.content += `\n\n${turn.text}`;
    } else {
      messages.push({ role: turn.role, content: turn.text });
    }
  }
  if (messages[0]?.role === "assistant") messages.shift();

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (req.image) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: req.image.mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
        data: req.image.data,
      },
    });
  }
  content.push({
    type: "text",
    text:
      `<current_plan>\n${JSON.stringify(req.plan)}\n</current_plan>\n\n` +
      (req.plan.rooms.length ? "" : "(The canvas is empty.)\n\n") +
      req.message,
  });
  if (messages[messages.length - 1]?.role === "user") {
    messages[messages.length - 1] = {
      role: "user",
      content: [{ type: "text", text: String(messages[messages.length - 1].content) }, ...content],
    };
  } else {
    messages.push({ role: "user", content });
  }

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: {
      effort: EFFORT,
      format: { type: "json_schema", schema: agentOutputSchema },
    },
    system: SYSTEM,
    messages,
  });
  const msg = await stream.finalMessage();

  if (msg.stop_reason === "refusal") {
    return { reply: "Sorry, I can't help with that request.", plan: null, mode: "claude" };
  }
  if (msg.stop_reason === "max_tokens") {
    return {
      reply: "That plan got too long for me to finish. Could you try a smaller layout, or ask for one area at a time?",
      plan: null,
      mode: "claude",
    };
  }

  const text = msg.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let parsed: { reply?: string; plan?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    return { reply: text || "I couldn't produce a response. Please try again.", plan: null, mode: "claude" };
  }
  return {
    reply: parsed.reply || "Here's a proposal.",
    plan: parsed.plan ? normalizePlan(parsed.plan) : null,
    mode: "claude",
  };
}
