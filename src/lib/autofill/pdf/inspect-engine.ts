/**
 * Pure-TS port of `inspect_pdf.py` — detects page geometry, AcroForm field count,
 * blank fill-rules (vector + leader-dot), checkbox squares (rect / curve / glyph)
 * and rect-grid matrix tables, each with nearby label text. Emits the SAME JSON
 * shape the Python script did (consumed by `schemas.ts:RawAnchors`), so the rest
 * of the pipeline is unchanged.
 *
 * Geometry comes from `mupdf-extract.ts`, which reproduces pdfplumber's
 * primitives (top-left coords); the heuristics below mirror the Python 1:1,
 * including the `H - top` flip to PDF bottom-left for emitted coordinates.
 */
import { PDFDocument } from "pdf-lib";
import {
  extractPages,
  type Char,
  type ExtractedPage,
  type Word,
} from "./mupdf-extract";
import { r1, ri, bboxKey } from "./round";

const LEADER_CHARS = new Set([".", "…", "．", "·", "﹒", "_"]);
const BOX_GLYPHS = new Set([
  0x2610, 0x25a1, 0x2751, 0x274f, 0x2b1c, 0x25fb, 0x2752, 0x2b26, 0x2b27,
  0x25a2, 0x25ab, 0x2b1a,
]);

type RawBlank = {
  id: string;
  x0: number;
  x1: number;
  pdf_y_line: number;
  suggest_x: number;
  suggest_baseline: number;
  via: string;
  size?: number;
  label_left: string;
};
type RawCheckbox = {
  id: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  cx: number;
  cy_pdf: number;
  size: number;
  label_right: string;
};
type RawTable = {
  id: string;
  x0: number;
  x1: number;
  columns: { x0: number; x1: number; cx: number; header: string }[];
  rows: {
    top: number;
    bottom: number;
    cy_pdf: number;
    h: number;
    grey: boolean;
    label_left: string;
  }[];
};
type RawPage = {
  index: number;
  width: number;
  height: number;
  blanks: RawBlank[];
  checkboxes: RawCheckbox[];
  tables: RawTable[];
};
export type RawAnchorsData = {
  src: string;
  acroform_fields: { name: string; type: string; value: string }[];
  pages: RawPage[];
};

/** Run the full inspection and return the RawAnchors-shaped object. */
export async function inspectPdf(
  pdfPath: string,
  bytes: Uint8Array,
): Promise<RawAnchorsData> {
  // Independent parses of the same bytes (mupdf vs pdf-lib) — run concurrently.
  const [pages, acroform_fields] = await Promise.all([
    extractPages(bytes),
    acroFields(bytes),
  ]);
  return {
    src: pdfPath,
    acroform_fields,
    pages: pages.map(inspectPage),
  };
}

/** AcroForm field list via pdf-lib (only the count is consumed downstream). */
async function acroFields(
  bytes: Uint8Array,
): Promise<{ name: string; type: string; value: string }[]> {
  try {
    const doc = await PDFDocument.load(bytes, {
      updateMetadata: false,
      ignoreEncryption: true,
    });
    return doc
      .getForm()
      .getFields()
      .map((f) => ({ name: f.getName(), type: f.constructor.name, value: "" }));
  } catch {
    return [];
  }
}

function inspectPage(pg: ExtractedPage): RawPage {
  const H = pg.height;
  const W = pg.width;
  const words = pg.words;

  const labelLeft = (yTop: number, xLim: number, band = 7): string => {
    const picks = words.filter(
      (w) => Math.abs(w.bottom - yTop) < band && w.x1 <= xLim + 2,
    );
    picks.sort((a, b) => a.x0 - b.x0);
    return picks
      .map((w) => w.text)
      .join(" ")
      .slice(-80);
  };
  const labelRight = (
    top: number,
    bottom: number,
    xFrom: number,
    band = 6,
    maxdx = 140,
  ): string => {
    const cy = (top + bottom) / 2;
    const picks = words.filter(
      (w) =>
        Math.abs((w.top + w.bottom) / 2 - cy) < band &&
        w.x0 >= xFrom - 1 &&
        w.x0 - xFrom < maxdx,
    );
    picks.sort((a, b) => a.x0 - b.x0);
    return picks
      .map((w) => w.text)
      .join(" ")
      .slice(0, 60);
  };

  // ---- blank fill-rules: thin horizontal lines + thin filled rects ----
  const rules: [number, number, number][] = [];
  for (const l of pg.lines) {
    if (Math.abs(l.top - l.bottom) < 0.9 && Math.abs(l.x1 - l.x0) > 20) {
      rules.push([Math.min(l.x0, l.x1), Math.max(l.x0, l.x1), l.top]);
    }
  }
  for (const rc of pg.rects) {
    const h = rc.bottom - rc.top;
    if (rc.fill && h < 1.3 && rc.x1 - rc.x0 > 20) {
      rules.push([rc.x0, rc.x1, (rc.top + rc.bottom) / 2]);
    }
  }
  const seen = new Set<string>();
  const blanks: RawBlank[] = [];
  for (const [x0, x1, top] of rules.sort(
    (a, b) => ri(a[2]) - ri(b[2]) || a[0] - b[0],
  )) {
    const k = bboxKey(x0, x1, top);
    if (seen.has(k)) continue;
    seen.add(k);
    blanks.push({
      id: `p${pg.index}_L${blanks.length}`,
      x0: r1(x0),
      x1: r1(x1),
      pdf_y_line: r1(H - top),
      suggest_x: r1(x0 + 3),
      suggest_baseline: r1(H - top + 2.2),
      via: "rule",
      label_left: labelLeft(top, x0),
    });
  }

  // ---- dotted / underscore leader answer-lines (text-glyph runs) ----
  const leaderRows = new Map<number, Char[]>();
  for (const c of pg.chars) {
    if (LEADER_CHARS.has(c.text)) {
      const key = ri(c.bottom);
      const arr = leaderRows.get(key) ?? [];
      arr.push(c);
      leaderRows.set(key, arr);
    }
  }
  // [ri(baseline), ri(x)] pairs of already-emitted blanks; emitLeader compares
  // these numbers directly, so no string encode/parse round-trip is needed.
  const ruleKeys: [number, number][] = blanks.map((b) => [
    ri(b.suggest_baseline),
    ri(b.suggest_x),
  ]);
  const lstripLeaders = (s: string): string => {
    let i = 0;
    while (i < s.length && (LEADER_CHARS.has(s[i]) || s[i] === " ")) i++;
    return s.slice(i);
  };
  const emitLeader = (seg: Char[]) => {
    if (seg.length < 4) return;
    const x0 = seg[0].x0;
    const x1 = seg[seg.length - 1].x1;
    if (x1 - x0 < 30) return;
    const bottom = Math.max(...seg.map((c) => c.bottom));
    const baseline = H - bottom;
    const szs = seg.map((c) => c.size).sort((a, b) => a - b);
    const sz = r1(szs[Math.floor(szs.length / 2)]);
    const sx = r1(x0 + 3);
    const sb = r1(baseline + Math.max(3.0, sz * 0.32));
    for (const [ky, kx] of ruleKeys) {
      if (Math.abs(ri(sb) - ky) < 4 && Math.abs(ri(sx) - kx) < 16) return;
    }
    ruleKeys.push([ri(sb), ri(sx)]);
    blanks.push({
      id: `p${pg.index}_L${blanks.length}`,
      x0: r1(x0),
      x1: r1(x1),
      pdf_y_line: r1(baseline),
      suggest_x: sx,
      suggest_baseline: sb,
      size: sz,
      via: "leader",
      label_left: lstripLeaders(labelLeft(bottom, x0, 8)),
    });
  };
  for (const [, cs] of [...leaderRows.entries()].sort((a, b) => a[0] - b[0])) {
    cs.sort((a, b) => a.x0 - b.x0);
    let seg: Char[] = [];
    for (const c of cs) {
      if (seg.length && c.x0 - seg[seg.length - 1].x1 > 25) {
        emitLeader(seg);
        seg = [];
      }
      seg.push(c);
    }
    emitLeader(seg);
  }
  blanks.sort((a, b) => b.pdf_y_line - a.pdf_y_line || a.suggest_x - b.suggest_x);

  // ---- checkbox squares: stroked ~square rects 6..22pt ----
  const cboxes: RawCheckbox[] = [];
  const cseen = new Set<string>();
  const pushBox = (x0: number, x1: number, top: number, bottom: number) => {
    const w = x1 - x0;
    const h = bottom - top;
    cboxes.push({
      id: `p${pg.index}_C${cboxes.length}`,
      x0: r1(x0),
      x1: r1(x1),
      top: r1(top),
      bottom: r1(bottom),
      cx: r1((x0 + x1) / 2),
      cy_pdf: r1(H - (top + bottom) / 2),
      size: r1(Math.min(w, h)),
      label_right: labelRight(top, bottom, x1),
    });
  };
  for (const rc of pg.rects) {
    const w = rc.x1 - rc.x0;
    const h = rc.bottom - rc.top;
    const ar = h ? w / h : 99;
    if (rc.stroke && w >= 7 && w <= 26 && h >= 6 && h <= 22 && ar >= 0.6 && ar <= 2.6) {
      const k = bboxKey(rc.x0, rc.top);
      if (cseen.has(k)) continue;
      cseen.add(k);
      pushBox(rc.x0, rc.x1, rc.top, rc.bottom);
    }
  }
  // curve checkboxes: rounded-square boxes drawn as curves
  for (const cv of pg.curves) {
    const w = cv.x1 - cv.x0;
    const h = cv.bottom - cv.top;
    const ar = h ? w / h : 99;
    if (w >= 8 && w <= 26 && h >= 8 && h <= 22 && ar >= 0.6 && ar <= 2.0) {
      const k = bboxKey(cv.x0, cv.top);
      if (cseen.has(k)) continue;
      cseen.add(k);
      pushBox(cv.x0, cv.x1, cv.top, cv.bottom);
    }
  }
  // glyph checkboxes: empty-box characters
  for (const c of pg.chars) {
    const t = c.text;
    if ([...t].length !== 1 || !BOX_GLYPHS.has(t.codePointAt(0)!)) continue;
    const k = bboxKey(c.x0, c.top);
    if (cseen.has(k)) continue;
    cseen.add(k);
    pushBox(c.x0, c.x1, c.top, c.bottom);
  }
  cboxes.sort((a, b) => ri(a.top) - ri(b.top) || a.x0 - b.x0);

  // ---- rect-grid matrix tables (scoring / Yes-No matrices) ----
  const tables = detectTables(pg, words, H);

  return {
    index: pg.index,
    width: r1(W),
    height: r1(H),
    blanks,
    checkboxes: cboxes,
    tables,
  };
}

/** Reconstruct rect-grid answer tables (mirrors inspect_pdf.py table block). */
function detectTables(
  pg: ExtractedPage,
  words: Word[],
  H: number,
): RawTable[] {
  // vertical segments: thin tall lines + thin tall rects → x centers
  const vseg: number[] = [];
  for (const l of pg.lines) {
    if (Math.abs(l.x1 - l.x0) < 1 && Math.abs(l.top - l.bottom) > 12) {
      vseg.push(r1((l.x0 + l.x1) / 2));
    }
  }
  for (const rc of pg.rects) {
    if (Math.abs(rc.x1 - rc.x0) < 2 && rc.bottom - rc.top > 12) {
      vseg.push(r1((rc.x0 + rc.x1) / 2));
    }
  }
  // vseg values are already r1-quantised, so tally by the number directly
  // instead of round-tripping through a toFixed(1) string and back.
  const vcount = new Map<number, number>();
  for (const x of vseg) vcount.set(x, (vcount.get(x) ?? 0) + 1);
  const edges = [...vcount.entries()]
    .filter(([, c]) => c >= 3)
    .map(([x]) => x)
    .sort((a, b) => a - b);
  const merged: number[] = [];
  for (const x of edges) {
    if (merged.length && x - merged[merged.length - 1] < 4) continue;
    merged.push(x);
  }
  if (merged.length < 3) return [];

  const xmin = merged[0];
  const xmax = merged[merged.length - 1];

  // horizontal borders: thin wide lines + thin wide rects spanning the grid
  const cov = new Map<number, [number, number]>();
  const extend = (yk: number, a: number, b: number) => {
    const prev = cov.get(yk) ?? [1e9, -1e9];
    cov.set(yk, [Math.min(prev[0], a), Math.max(prev[1], b)]);
  };
  for (const l of pg.lines) {
    if (Math.abs(l.top - l.bottom) < 1 && Math.abs(l.x1 - l.x0) > 5) {
      extend(ri(l.top), Math.min(l.x0, l.x1), Math.max(l.x0, l.x1));
    }
  }
  for (const rc of pg.rects) {
    if (rc.bottom - rc.top < 2 && rc.x1 - rc.x0 > 5) {
      extend(ri((rc.top + rc.bottom) / 2), rc.x0, rc.x1);
    }
  }
  const borders = [...cov.entries()]
    .filter(([, [a, b]]) => a <= xmin + 8 && b >= xmax - 8)
    .map(([y]) => y)
    .sort((a, b) => a - b);
  if (borders.length < 3) return [];

  const cols: { x0: number; x1: number; cx: number; header: string }[] = [];
  for (let i = 0; i < merged.length - 1; i++) {
    cols.push({
      x0: merged[i],
      x1: merged[i + 1],
      cx: r1((merged[i] + merged[i + 1]) / 2),
      header: "",
    });
  }
  const top0 = borders[0];
  const headEnd = borders[1]; // borders.length >= 3 guaranteed above
  for (const c of cols) {
    const hw = words.filter(
      (w) =>
        top0 - 2 < w.top &&
        w.top < headEnd + 2 &&
        c.x0 - 1 <= (w.x0 + w.x1) / 2 &&
        (w.x0 + w.x1) / 2 <= c.x1 + 1,
    );
    hw.sort((a, b) => a.x0 - b.x0);
    c.header = hw
      .map((w) => w.text)
      .join(" ")
      .slice(0, 28);
  }

  // grey header/section bands: wide greyish filled rects
  const greyBands: [number, number][] = [];
  for (const rc of pg.rects) {
    const col = rc.non_stroking_color;
    if (
      rc.fill &&
      Array.isArray(col) &&
      col.length === 3 &&
      col.every((c) => c >= 0.55 && c <= 0.92) &&
      Math.max(...col) - Math.min(...col) < 0.05 &&
      rc.x1 - rc.x0 > 110 &&
      rc.bottom - rc.top > 3
    ) {
      greyBands.push([rc.top, rc.bottom]);
    }
  }

  const rows = [];
  for (let i = 0; i + 1 < borders.length; i++) {
    const a = borders[i];
    const b = borders[i + 1];
    const cyt = (a + b) / 2;
    const lab = words.filter(
      (w) =>
        a - 1 <= (w.top + w.bottom) / 2 &&
        (w.top + w.bottom) / 2 <= b + 1 &&
        w.x1 <= cols[0].x1 + 1,
    );
    lab.sort((x, y) => ri(x.top) - ri(y.top) || x.x0 - y.x0);
    rows.push({
      top: r1(a),
      bottom: r1(b),
      cy_pdf: r1(H - cyt),
      h: r1(b - a),
      grey: greyBands.some(([gt, gb]) => gt - 1 <= cyt && cyt <= gb + 1),
      label_left: lab
        .map((w) => w.text)
        .join(" ")
        .slice(0, 90),
    });
  }

  return [{ id: `p${pg.index}_T0`, x0: xmin, x1: xmax, columns: cols, rows }];
}
