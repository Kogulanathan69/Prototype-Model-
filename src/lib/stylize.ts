// Image filters applied to a captured render: watercolor paper/pigment and pencil sketch.

export async function loadImage(url: string) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

function toCanvas(img: HTMLImageElement) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return { c, ctx };
}

function luminance(d: Uint8ClampedArray, n: number) {
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  return L;
}

function sobel(L: Float32Array, w: number, h: number) {
  const E = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1] + L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1];
      const gy = -L[i - w - 1] - 2 * L[i - w] - L[i - w + 1] + L[i + w - 1] + 2 * L[i + w] + L[i + w + 1];
      E[i] = Math.min(1, Math.hypot(gx, gy));
    }
  return E;
}

/** Smooth value noise in [0,1], used for paper texture and pigment blooms. */
function valueNoise(w: number, h: number, cell: number, seed: number) {
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
  const g = new Float32Array(gw * gh);
  let s = seed;
  for (let i = 0; i < g.length; i++) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    g[i] = s / 4294967296;
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = y / cell, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < w; x++) {
      const fx = x / cell, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
      const a = g[iy * gw + ix], b = g[iy * gw + ix + 1], c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
      out[y * w + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

/**
 * Watercolor: the render already went through a Kuwahara (painterly) filter on the GPU.
 * Here we lift values toward paper white, pool pigment along edges, add blooms and paper grain.
 */
export async function watercolor(url: string) {
  const img = await loadImage(url);
  const { c, ctx } = toCanvas(img);
  const { width: w, height: h } = c;
  const im = ctx.getImageData(0, 0, w, h);
  const d = im.data;
  await yieldFrame();
  const L = luminance(d, w * h);
  const E = sobel(L, w, h);
  const bloom = valueNoise(w, h, Math.max(40, w / 18), 7);
  const grain = valueNoise(w, h, 3, 11);
  const fibre = valueNoise(w, h, 14, 23);
  await yieldFrame();
  for (let i = 0; i < w * h; i++) {
    const k = i * 4;
    // boost saturation so washes stay colourful after dilution
    const grey = L[i] * 255;
    const rgb = [0, 1, 2].map((ch) => grey + (d[k + ch] - grey) * 1.45);
    // dilute pigment slightly toward the paper, more in the lightest areas
    const dilute = 0.06 + 0.16 * L[i] * L[i];
    // uneven pigment density (blooms) and pooling along edges
    const density = 1.0 + 0.32 * (bloom[i] - 0.5) + 1.1 * E[i];
    const paper = 0.95 + 0.04 * grain[i] + 0.02 * fibre[i];
    for (let ch = 0; ch < 3; ch++) {
      const pigment = Math.max(0, 255 - rgb[ch]); // absorbance
      const v = 255 - pigment * (1 - dilute) * density;
      const tint = ch === 0 ? 255 : ch === 1 ? 252 : 244; // warm white paper
      d[k + ch] = Math.max(0, Math.min(255, (v / 255) * tint * paper));
    }
  }
  ctx.putImageData(im, 0, 0);
  return c.toDataURL("image/png");
}

/** Pencil sketch: outlines from edges plus hatching that follows tone, on warm paper. */
export async function sketch(url: string) {
  const img = await loadImage(url);
  const { c, ctx } = toCanvas(img);
  const { width: w, height: h } = c;
  const im = ctx.getImageData(0, 0, w, h);
  const d = im.data;
  await yieldFrame();
  const L = luminance(d, w * h);
  const E = sobel(L, w, h);
  const grain = valueNoise(w, h, 2, 5);
  const wobble = valueNoise(w, h, 9, 13);
  const spacing = Math.max(5, Math.round(w / 260));
  await yieldFrame();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = L[i];
      let ink = Math.min(1, Math.max(0, (E[i] - 0.08) * 3.2)); // outlines
      const offset = Math.round(wobble[i] * 3);
      if (l < 0.62 && (x + y + offset) % spacing === 0) ink = Math.max(ink, 0.35 + (0.62 - l));
      if (l < 0.38 && (x - y + 4096 * spacing + offset) % spacing === 0) ink = Math.max(ink, 0.45 + (0.38 - l));
      if (l < 0.2 && (x + offset) % Math.max(3, spacing - 2) === 0) ink = Math.max(ink, 0.6);
      ink = Math.min(1, ink * (0.75 + 0.35 * grain[i]));
      const paper = 0.95 + 0.05 * grain[i];
      const k = i * 4;
      d[k] = (252 * paper) * (1 - ink) + 48 * ink;
      d[k + 1] = (249 * paper) * (1 - ink) + 46 * ink;
      d[k + 2] = (241 * paper) * (1 - ink) + 44 * ink;
    }
  ctx.putImageData(im, 0, 0);
  return c.toDataURL("image/png");
}

/** Downscale and re-encode as JPEG for upload (keeps requests small). */
export async function toUploadJpeg(url: string, maxSide = 1536) {
  const img = await loadImage(url);
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL("image/jpeg", 0.92);
  return { data: dataUrl.split(",")[1], mediaType: "image/jpeg", width: c.width, height: c.height };
}
