import { FURNITURE_TYPES, ROOM_TYPES } from "../src/shared/plan.ts";

const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const int = { type: "integer" };
const orientation = { type: "string", enum: ["horizontal", "vertical"] };

const planSchema = obj({
  name: { type: "string" },
  rooms: {
    type: "array",
    items: obj({
      id: { type: "string" },
      name: { type: "string" },
      type: { type: "string", enum: [...ROOM_TYPES] },
      x: int,
      y: int,
      width: int,
      height: int,
    }),
  },
  doors: {
    type: "array",
    items: obj({ id: { type: "string" }, x: int, y: int, width: int, orientation, flip: { type: "boolean" } }),
  },
  windows: {
    type: "array",
    items: obj({ id: { type: "string" }, x: int, y: int, width: int, orientation }),
  },
  furniture: {
    type: "array",
    items: obj({
      id: { type: "string" },
      type: { type: "string", enum: [...FURNITURE_TYPES] },
      x: int,
      y: int,
      width: int,
      depth: int,
      rotation: { type: "integer", enum: [0, 90, 180, 270] },
    }),
  },
});

/** Structured output for every agent turn: a chat reply plus an optional full proposed plan. */
export const agentOutputSchema = obj({
  reply: { type: "string" },
  plan: { anyOf: [planSchema, { type: "null" }] },
});
