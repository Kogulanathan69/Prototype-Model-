// Offline demo agent: a small rule-based layout generator, so the app works without an API key.
import { snap, totalArea, type ChatRequest, type ChatResponse, type Door, type FloorPlan, type Furniture, type Opening, type Room } from "../src/shared/plan.ts";

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, single: 1 };

const MAX_BEDROOMS = 4;

/** What one message says. Fields are undefined when the message doesn't mention them. */
function parseMessage(text: string) {
  const t = text.toLowerCase();
  let bedrooms: number | undefined;
  let requested: number | undefined;
  if (/studio/.test(t)) bedrooms = 0;
  const m = t.match(/(\d+|one|two|three|four|five|six|single)[\s-]*(bed(room)?s?|br)\b/);
  if (m) {
    requested = Number(m[1]) || WORDS[m[1]] || ({ five: 5, six: 6 } as Record<string, number>)[m[1]] || 2;
    bedrooms = Math.min(MAX_BEDROOMS, requested);
  }
  const flag = (yes: RegExp, no: RegExp) => (no.test(t) ? false : yes.test(t) ? true : undefined);
  return {
    bedrooms,
    requested,
    balcony: flag(/balcon|terrace|patio/, /\b(no|without|remove|drop)\b[^.,]*\b(balcon|terrace|patio)/),
    office: flag(/office|study|work from home|wfh/, /\b(no|without|remove|drop)\b[^.,]*\b(office|study)/),
  };
}

/**
 * The latest message wins. A message that states a bedroom count (or "studio") starts a fresh brief;
 * otherwise it's a follow-up ("add a balcony") and inherits the earlier brief.
 */
function parse(history: string[], latest: string) {
  const now = parseMessage(latest);
  const brief = { bedrooms: 2, requested: undefined as number | undefined, balcony: false, office: false };
  if (now.bedrooms === undefined) {
    for (const h of history) {
      const p = parseMessage(h);
      if (p.bedrooms !== undefined) Object.assign(brief, { bedrooms: p.bedrooms, requested: p.requested, balcony: false, office: false });
      if (p.balcony !== undefined) brief.balcony = p.balcony;
      if (p.office !== undefined) brief.office = p.office;
    }
  } else {
    brief.bedrooms = now.bedrooms;
    brief.requested = now.requested;
  }
  if (now.balcony !== undefined) brief.balcony = now.balcony;
  if (now.office !== undefined) brief.office = now.office;
  return brief;
}

export function demoAgent(req: ChatRequest): ChatResponse {
  const opts = parse(req.history.filter((h) => h.role === "user").map((h) => h.text), req.message);
  const plan = generate(opts);
  const area = totalArea(plan).toFixed(1);
  const parts = [
    opts.bedrooms === 0 ? "a studio" : `${opts.bedrooms} bedroom${opts.bedrooms > 1 ? "s" : ""}`,
    "an open living / dining / kitchen space",
    "a bathroom off the hall",
    opts.office ? "a home office" : null,
    opts.balcony ? "a balcony off the living area" : null,
  ].filter(Boolean);
  return {
    mode: "demo",
    plan,
    reply:
      `Here's a ${area} m² layout with ${parts.join(", ")}. ` +
      (opts.requested && opts.requested > MAX_BEDROOMS ? `The offline template supports at most ${MAX_BEDROOMS} bedrooms, so I capped it there. ` : "") +
      `(Offline demo mode: the layout comes from a fixed template. Add an ANTHROPIC_API_KEY to get real AI design and chat-based edits.) ` +
      `Accept it to start editing, or describe what you'd like instead.`,
  };
}

function generate({ bedrooms, balcony, office }: { bedrooms: number; balcony: boolean; office: boolean }): FloorPlan {
  const bottomCount = bedrooms + (office ? 1 : 0) + (bedrooms === 0 ? 1 : 0);
  const W = snap(Math.max(8000, 2400 + bottomCount * 3200), 100);
  const Y0 = balcony ? 1600 : 0;
  const LIV_H = 5000, HALL_H = 1400, BOT_H = 3600;
  const hallY = Y0 + LIV_H, botY = hallY + HALL_H;
  const balW = Math.min(4000, W / 2);

  const rooms: Room[] = [];
  const doors: Door[] = [];
  const windows: Opening[] = [];
  const furniture: Furniture[] = [];
  const f = (type: Furniture["type"], x: number, y: number, width: number, depth: number, rotation = 0) =>
    furniture.push({ id: `f_${furniture.length + 1}`, type, x, y, width, depth, rotation });

  if (balcony) {
    rooms.push({ id: "room_balcony", name: "Balcony", type: "balcony", x: 0, y: 0, width: balW, height: 1600 });
    doors.push({ id: "door_balcony", x: balW / 2, y: Y0, width: 900, orientation: "horizontal", flip: true }); // swings out onto the balcony, clear of the lounge
    f("armchair", 700, 800, 850, 850, 0);
    f("plant", balW - 450, 600, 450, 450);
  }

  rooms.push({ id: "room_living", name: "Living / dining / kitchen", type: "living", x: 0, y: Y0, width: W, height: LIV_H });
  rooms.push({ id: "room_hall", name: "Hall", type: "hall", x: 0, y: hallY, width: W, height: HALL_H });

  // Living / kitchen windows
  if (balcony) windows.push({ id: "win_living_n", x: snap((balW + W) / 2, 10), y: Y0, width: 2000, orientation: "horizontal" });
  else {
    windows.push({ id: "win_living_n1", x: snap(W / 4, 10), y: Y0, width: 1800, orientation: "horizontal" });
    windows.push({ id: "win_living_n2", x: snap((3 * W) / 4, 10), y: Y0, width: 1800, orientation: "horizontal" });
  }
  windows.push({ id: "win_living_e", x: W, y: Y0 + 2500, width: 1500, orientation: "vertical" });

  // Kitchen run along the top-right, dining table below it
  f("kitchen_counter", W - 1360, Y0 + 360, 2400, 600);
  f("fridge", W - 2960, Y0 + 410, 700, 700);
  const tx = W - 1900, ty = Y0 + 2300;
  f("dining_table", tx, ty, 1600, 900);
  for (const dx of [-400, 400]) {
    f("chair", tx + dx, ty - 720, 480, 500, 0);
    f("chair", tx + dx, ty + 720, 480, 500, 180);
  }
  // Lounge along the left wall
  f("tv_unit", 260, Y0 + 2700, 1600, 400, 270);
  f("rug", 1700, Y0 + 2700, 2000, 1400, 90);
  f("coffee_table", 1600, Y0 + 2700, 1100, 600, 90);
  f("sofa", 2700, Y0 + 2700, 2100, 900, 90);

  // Hall
  doors.push({ id: "door_entrance", x: 0, y: hallY + 700, width: 950, orientation: "vertical", flip: false });
  doors.push({ id: "door_living", x: snap(W / 2, 10), y: hallY, width: 900, orientation: "horizontal", flip: true });

  // Bottom band: bathroom, then bedrooms / office / storage
  rooms.push({ id: "room_bath", name: "Bathroom", type: "bathroom", x: 0, y: botY, width: 2400, height: BOT_H });
  doors.push({ id: "door_bath", x: 600, y: botY, width: 800, orientation: "horizontal", flip: false });
  windows.push({ id: "win_bath", x: 1200, y: botY + BOT_H, width: 600, orientation: "horizontal" });
  f("washbasin", 2400 - 285, botY + 800, 600, 450, 90);
  f("toilet", 2400 - 385, botY + 1700, 400, 650, 90);
  f("shower", 60 + 450, botY + BOT_H - 510, 900, 900);
  f("washing_machine", 2400 - 360, botY + BOT_H - 360, 600, 600);

  type Slot = { kind: "bedroom" | "office" | "storage"; name: string };
  const slots: Slot[] = [];
  for (let i = 0; i < bedrooms; i++) slots.push({ kind: "bedroom", name: i === 0 && bedrooms > 1 ? "Primary bedroom" : bedrooms > 1 ? `Bedroom ${i + 1}` : "Bedroom" });
  if (office) slots.push({ kind: "office", name: "Office" });
  if (bedrooms === 0) slots.push({ kind: "storage", name: "Storage" });

  const bw = snap((W - 2400) / slots.length, 50);
  slots.forEach((s, i) => {
    const x = 2400 + i * bw;
    const w = i === slots.length - 1 ? W - x : bw;
    const r: Room = { id: `room_${s.kind}_${i + 1}`, name: s.name, type: s.kind === "storage" ? "storage" : s.kind, x, y: botY, width: w, height: BOT_H };
    rooms.push(r);
    doors.push({ id: `door_${s.kind}_${i + 1}`, x: x + 600, y: botY, width: 800, orientation: "horizontal", flip: false });
    if (s.kind !== "storage") windows.push({ id: `win_${s.kind}_${i + 1}`, x: snap(x + w / 2, 10), y: botY + BOT_H, width: 1400, orientation: "horizontal" });
    if (s.kind === "bedroom") {
      const double = i === 0;
      const bedW = double ? 1600 : 900;
      f(double ? "bed_double" : "bed_single", x + w - 60 - 1000, botY + BOT_H / 2 + 300, bedW, 2000, 90);
      f("wardrobe", x + 60 + 300, botY + 2300, 1800, 600, 270);
    } else if (s.kind === "office") {
      f("desk", x + w / 2, botY + BOT_H - 410, 1400, 700, 180);
      f("chair", x + w / 2, botY + BOT_H - 1050, 480, 500, 0);
      f("bookshelf", x + w - 220, botY + 1500, 900, 320, 90);
    }
  });

  const plan: FloorPlan = {
    name: bedrooms === 0 ? "Studio apartment" : `${bedrooms}-bedroom apartment`,
    rooms,
    doors,
    windows,
    furniture,
  };

  return plan;
}
