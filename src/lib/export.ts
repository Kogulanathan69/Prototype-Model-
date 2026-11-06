import type { FloorPlan } from "../shared/plan";

const fileName = (plan: FloorPlan, ext: string) =>
  `${plan.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "floor-plan"}.${ext}`;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Serialise the 2D plan SVG without editor-only elements (handles, grid, selection). */
function cleanSvg(svg: SVGSVGElement) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll("[data-editor-only]").forEach((n) => n.remove());
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const vb = svg.dataset.exportViewbox;
  if (vb) clone.setAttribute("viewBox", vb);
  const [, , w, h] = (clone.getAttribute("viewBox") || "0 0 1000 1000").split(" ").map(Number);
  clone.setAttribute("width", String(Math.round(w / 5)));
  clone.setAttribute("height", String(Math.round(h / 5)));
  return { markup: new XMLSerializer().serializeToString(clone), w, h };
}

export function exportSvg(svg: SVGSVGElement, plan: FloorPlan) {
  download(new Blob([cleanSvg(svg).markup], { type: "image/svg+xml" }), fileName(plan, "svg"));
}

export async function exportPng(svg: SVGSVGElement, plan: FloorPlan) {
  const { markup, w, h } = cleanSvg(svg);
  const scale = Math.min(4000 / w, 4000 / h, 0.5);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  canvas.toBlob((b) => b && download(b, fileName(plan, "png")), "image/png");
}

export function exportJson(plan: FloorPlan) {
  download(new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }), fileName(plan, "json"));
}
