# Roomwright

An AI floor-plan designer. Describe a home in chat (optionally attach a sketch). The agent proposes a plan, and you
preview it and accept or discard it. Then you can edit it by hand in 2D, walk around it in 3D, and export it.

## Run it

```bash
npm install
cp .env.example .env      # then paste your ANTHROPIC_API_KEY into .env
npm run dev               # web on http://localhost:5173, API on :3001
```

Without an API key the server runs in **offline demo mode**: a rule-based template generator makes the layouts
(it understands bedroom count, studio, balcony and office), so the whole UI still works.

Production: `npm run build && npm start` serves the built app and API from port 3001.

## Features

- **Chat agent** (Claude Opus 5.5 with structured JSON output). Every turn returns a reply and, when something
  changes, a complete proposed plan. Follow-ups like "make the kitchen bigger" edit the current plan, including
  any changes you made by hand.
- **Propose → confirm flow.** Proposals preview read-only on the canvas until you accept them.
- **Reference images.** Attach or paste a sketch or an existing plan.
- **2D editor.** Move, resize and draw rooms. Doors and windows snap to walls. The furniture library has 22 items.
  Keyboard shortcuts: `V` select, `R` room or rotate, `D` door, `W` window, `F` flip door, `Del` delete,
  `Ctrl+Z` / `Ctrl+Y` undo and redo, scroll to zoom, drag to pan.
- **Plan check.** The inspector warns about overlapping rooms, doors or windows that aren't on a wall, and
  furniture outside a room. Doors and windows move with their room when you move or resize it.
- **3D view** (three.js). Walls with door and window openings, floors, furniture.
- **Rendered views** (the **Render** button). A render studio that runs in the browser:
  - **Styles:** Photoreal, Watercolor and Sketch.
  - **Cameras:** bird's-eye, top-down, and eye level inside any room (drag to look around).
  - **Lighting:** daylight, golden hour and evening, with optional ceilings.
  - **Materials:** textured floors (oak, walnut, tile, stone, carpet, concrete), soft shadows and ambient occlusion.
  - High-resolution PNG downloads, plus a gallery for each project (kept for the browser session).
- **AI enhance (optional).** Sends a render to OpenAI's image-edit API for a photograph-like finish that keeps
  the layout. It's off unless `OPENAI_API_KEY` is set. Claude can't generate images, so this step uses an image model.
- **Export** as PNG, SVG or JSON. Import JSON. Several projects are autosaved in the browser.

## Layout

```
server/index.ts      Express API: /api/chat, /api/status
server/agent.ts      Claude call, system prompt, response handling
server/schema.ts     JSON schema the model's output must match
server/demo.ts       offline template generator
src/shared/plan.ts   plan model + geometry (walls from room edges, openings, snapping)
src/components/      PlanEditor2D (SVG editor), Plan3D, Chat, Inspector
src/lib/             undo history, project storage, export
```

The plan is the source of truth: rooms are axis-aligned rectangles in millimetres, and walls are derived by merging
room edges. Doors and windows are cut out of those walls. This keeps the model's output simple and reliable.

## Configuration (.env)

| Var | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | (none) | enables the Claude agent |
| `CLAUDE_MODEL` | `claude-opus-5-5` | |
| `CLAUDE_EFFORT` | `medium` | `low` is faster and cheaper, `high` gives more careful layouts |
| `PORT` | `3001` | |
| `OPENAI_API_KEY` | (none) | turns on AI enhance for renders (billed per image by OpenAI) |
| `OPENAI_IMAGE_MODEL` | `gpt-image-1` | image-edit model |
| `OPENAI_IMAGE_QUALITY` | `medium` | `low` / `medium` / `high` |
