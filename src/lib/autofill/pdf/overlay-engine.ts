/**
 * Pure-TS port of `overlay_fill.py` — stamps answers onto an existing PDF as an
 * overlay (the original page content is preserved). Replaces reportlab (drawing)
 * + pypdf (merge) with pdf-lib, which draws straight onto the loaded source
 * pages and re-saves.
 *
 * Coordinates are PDF points, origin bottom-left — identical to reportlab and to
 * what `assemble.ts` emits (suggest_x / baseline / cx / cy). Marks:
 *   text  — x, baseline, text (+ align left|center|right, optional knockout)
 *   check — cx + (cy | cy_pdf): "✓"/tick & "x"/cross drawn as vectors centred in
 *           a size×size box; "circle"/"oval" as a stroked ellipse; any other
 *           string as a font glyph.
 */
import fs from "node:fs/promises";
import { PDFDocument, rgb, LineCapStyle, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { OverlaySpec } from "../assemble";
import { loadFontBytes, roleWeight } from "./fonts";

type AnyItem = Record<string, unknown>;
const DEFAULT_COLOR: [number, number, number] = [0.05, 0.05, 0.55];

// Mark vocabularies for the check kind, named once so the cross set isn't
// written out twice (it's both part of the tick-or-cross test and the
// cross-only branch).
const CIRCLE_MARKS = ["circle", "oval", "o", "O", "◯", "○"];
const CROSS_MARKS = ["x", "X", "✗", "✕"];
const TICK_MARKS = ["✓", "check", "tick"];

/**
 * Coerce an item colour value to a pdf-lib rgb. Requires a full RGB triple — a
 * shorter array (e.g. a DeviceGray scalar) would pass undefined channels into
 * rgb() and throw, aborting the whole fill — so anything else uses the fallback.
 */
function toRgb(value: unknown, fallback: [number, number, number]) {
  const c =
    Array.isArray(value) && value.length >= 3 ? (value as number[]) : fallback;
  return rgb(c[0], c[1], c[2]);
}

const num = (v: unknown, d?: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : (d as number);
};

/** Fail loudly (with item locus) when a required field is missing. */
function need(it: AnyItem, keys: string[], pi: number, idx: number) {
  const missing = keys.filter((k) => !(k in it));
  if (missing.length)
    throw new Error(
      `item p${pi}#${idx} (${String(it.kind)}) missing ${missing.join(",")}`,
    );
}

export async function overlayFill(spec: OverlaySpec): Promise<string> {
  if (!spec.src) throw new Error("fills spec missing required 'src'");
  const srcBytes = await fs.readFile(spec.src);
  const doc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  doc.registerFontkit(fontkit);

  const bytes = await loadFontBytes();
  const fonts: Record<string, PDFFont> = {
    regular: await doc.embedFont(bytes.regular, { subset: true }),
    bold: await doc.embedFont(bytes.bold, { subset: true }),
  };
  const fontFor = (role: unknown): PDFFont =>
    fonts[roleWeight(typeof role === "string" ? role : "latin")];

  const pages = doc.getPages();
  const byPage = new Map<number, AnyItem[]>();
  for (const raw of spec.items as unknown as AnyItem[]) {
    const p = num(raw.page, 0);
    const arr = byPage.get(p) ?? [];
    arr.push(raw);
    byPage.set(p, arr);
  }

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const items = byPage.get(pi) ?? [];
    items.forEach((it, idx) => drawItem(page, it, pi, idx, fontFor));
  }

  const out = await doc.save();
  await fs.writeFile(spec.out, Buffer.from(out));
  return spec.out;
}

function drawItem(
  page: PDFPage,
  it: AnyItem,
  pi: number,
  idx: number,
  fontFor: (role: unknown) => PDFFont,
) {
  const kind = it.kind;
  const color = toRgb(it.color, DEFAULT_COLOR);

  if (kind === "text") {
    need(it, ["x", "baseline", "text"], pi, idx);
    const size = num(it.size, 8.5);
    const font = fontFor(it.font ?? "latin");
    const align = (it.align as string) ?? "left";
    const x = num(it.x);
    const baseline = num(it.baseline);
    const text = String(it.text);
    const tw = font.widthOfTextAtSize(text, size);
    const drawX =
      align === "right" ? x - tw : align === "center" ? x - tw / 2 : x;

    // knockout: opaque box behind the value so an underlying dotted/underscore
    // leader doesn't strike through it.
    if (it.knockout) {
      const pad = size * 0.12;
      page.drawRectangle({
        x: drawX - pad,
        y: baseline - size * 0.32,
        width: tw + 2 * pad,
        height: size * 1.25,
        color: toRgb(it.knockout_color, [1, 1, 1]),
      });
    }
    page.drawText(text, { x: drawX, y: baseline, size, font, color });
    return;
  }

  if (kind === "check") {
    need(it, ["cx"], pi, idx);
    const size = num(it.size, 10);
    const cx = num(it.cx);
    const cy = "cy" in it ? num(it.cy) : "cy_pdf" in it ? num(it.cy_pdf) : NaN;
    if (!Number.isFinite(cy))
      throw new Error(`check item p${pi}#${idx} needs 'cy' (or 'cy_pdf')`);
    const mark = (it.mark as string) ?? "✓";

    if (CIRCLE_MARKS.includes(mark)) {
      const w = num(it.w, size);
      const h = num(it.h, size);
      // stroke-only ellipse: zero fill opacity, full border opacity
      page.drawEllipse({
        x: cx,
        y: cy,
        xScale: w / 2,
        yScale: h / 2,
        borderColor: color,
        borderWidth: Math.max(1.0, size * 0.1),
        opacity: 0,
        borderOpacity: 1,
      });
      return;
    }

    if (TICK_MARKS.includes(mark) || CROSS_MARKS.includes(mark)) {
      const thickness = Math.max(1.0, size * 0.12);
      const line = (x1: number, y1: number, x2: number, y2: number) =>
        page.drawLine({
          start: { x: x1, y: y1 },
          end: { x: x2, y: y2 },
          thickness,
          color,
          lineCap: LineCapStyle.Round,
        });
      if (CROSS_MARKS.includes(mark)) {
        const d = size * 0.42;
        line(cx - d, cy - d, cx + d, cy + d);
        line(cx - d, cy + d, cx + d, cy - d);
      } else {
        // checkmark: short down-left arm to the vertex, long up-right arm
        line(cx - 0.42 * size, cy - 0.05 * size, cx - 0.15 * size, cy - 0.37 * size);
        line(cx - 0.15 * size, cy - 0.37 * size, cx + 0.45 * size, cy + 0.37 * size);
      }
      return;
    }

    // any other mark string → draw as a font glyph (may tofu)
    const font = fontFor(it.font ?? "thai");
    const tw = font.widthOfTextAtSize(mark, size);
    try {
      page.drawText(mark, {
        x: cx - tw / 2,
        y: cy - size * 0.36,
        size,
        font,
        color,
      });
    } catch {
      /* unencodable glyph — skip rather than crash the whole fill */
    }
    return;
  }

  throw new Error(
    `item p${pi}#${idx}: unknown kind ${JSON.stringify(kind)} (expected 'text' or 'check')`,
  );
}
