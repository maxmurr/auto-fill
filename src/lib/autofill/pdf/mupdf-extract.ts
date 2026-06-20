/**
 * pdfplumber-equivalent primitive extraction, powered by mupdf (WASM).
 *
 * The Python engine used pdfplumber's page model (`words`, `chars`, `lines`,
 * `rects`, `curves`) to drive every fill-rule / checkbox / table heuristic. This
 * module reconstructs the same primitives from mupdf so `inspect-engine.ts` and
 * `acroform-engine.ts` can port those heuristics ~1:1.
 *
 * Coordinate space matches pdfplumber: origin TOP-LEFT, y increases DOWNWARD,
 * units = PDF points. (`top`/`bottom` are distances from the page top, exactly
 * like pdfplumber; callers convert to PDF bottom-left with `H - top`.)
 *
 * mupdf is an ESM module with top-level await that initialises its WASM on
 * import — loaded lazily via `import("mupdf")` so it only spins up inside the
 * server step that needs it.
 */
import { round, bboxKey } from "./round";

export type Char = {
  text: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  size: number;
  /** mupdf reading-order line id — used to group words without re-sorting. */
  line: number;
};

export type Word = {
  text: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  size: number;
};

/** A vector rectangle (filled and/or stroked), pdfplumber `rect` shape. */
export type Rect = {
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  fill: boolean;
  stroke: boolean;
  /**
   * Fill colour, preserving colorspace shape like pdfplumber: a scalar for
   * DeviceGray, a 3-array for DeviceRGB, a 4-array for DeviceCMYK, null when not
   * filled. The grey-band heuristic only treats 3-arrays as bands, so DeviceGray
   * greys are (correctly) ignored.
   */
  non_stroking_color: number | number[] | null;
};

/** A straight line segment, pdfplumber `line` shape. */
export type Line = { x0: number; x1: number; top: number; bottom: number };

/** Anything with a bezier segment, pdfplumber `curve` shape. */
export type Curve = { x0: number; x1: number; top: number; bottom: number };

export type ExtractedPage = {
  index: number;
  width: number;
  height: number;
  words: Word[];
  chars: Char[];
  lines: Line[];
  rects: Rect[];
  curves: Curve[];
};

type Mupdf = typeof import("mupdf");
let _mupdf: Promise<Mupdf> | null = null;
/** Lazily import + init mupdf once per process. */
export function loadMupdf(): Promise<Mupdf> {
  if (!_mupdf) {
    // Clear the cache if the import rejects (transient WASM init failure), so a
    // later call can retry instead of every caller getting the cached rejection
    // forever — which would brick the engine until a process restart.
    _mupdf = import("mupdf").catch((e) => {
      _mupdf = null;
      throw e;
    });
  }
  return _mupdf;
}

const IDENTITY: [number, number, number, number, number, number] = [
  1, 0, 0, 1, 0, 0,
];

/** Apply a 6-tuple affine matrix to a point. */
function apply(
  m: [number, number, number, number, number, number],
  x: number,
  y: number,
): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * Keep a mupdf colour in pdfplumber's shape: DeviceGray → scalar, DeviceRGB →
 * 3-array, DeviceCMYK → 4-array. (Values already 0..1.)
 */
function rawColor(color: number[] | null | undefined): number | number[] | null {
  if (!color || !color.length) return null;
  if (color.length === 1) return color[0];
  return [...color];
}

type RawShape = {
  kind: "line" | "rect" | "curve";
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  fill: boolean;
  stroke: boolean;
  nsc: number | number[] | null;
};

/**
 * Classify one walked sub-path (points already in page space) into a
 * line / rect / curve, mirroring how pdfminer/pdfplumber bin painted paths.
 */
function classify(
  pts: [number, number][],
  hasCurve: boolean,
): { kind: "line" | "rect" | "curve" } {
  // drop a trailing point that just closes back to the start
  let p = pts;
  if (
    p.length > 1 &&
    Math.abs(p[0][0] - p[p.length - 1][0]) < 0.01 &&
    Math.abs(p[0][1] - p[p.length - 1][1]) < 0.01
  ) {
    p = p.slice(0, -1);
  }
  if (hasCurve) return { kind: "curve" };
  if (p.length === 2) return { kind: "line" };
  if (p.length === 4 && isAxisRect(p)) return { kind: "rect" };
  if (p.length === 3 && isAxisRect([...p, p[0]])) return { kind: "rect" };
  return { kind: "curve" };
}

/** True when 4 points form an axis-aligned rectangle (edges only H or V). */
function isAxisRect(p: [number, number][]): boolean {
  if (p.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = p[i];
    const b = p[(i + 1) % 4];
    const horiz = Math.abs(a[1] - b[1]) < 0.3;
    const vert = Math.abs(a[0] - b[0]) < 0.3;
    if (!horiz && !vert) return false;
  }
  return true;
}

/**
 * Extract every page's primitives from PDF bytes.
 * `bytes` may be a Buffer/Uint8Array of the file contents.
 */
export async function extractPages(
  bytes: Uint8Array,
): Promise<ExtractedPage[]> {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const pages: ExtractedPage[] = [];

  // mupdf objects are native WASM handles; free them explicitly (not just on GC)
  // so a long-lived server doesn't grow the WASM heap per request → OOM. Every
  // page's structured-text, device and page handle is destroyed in `finally`, and
  // the document in the outer `finally`, on both success and throw paths.
  try {
    const n = doc.countPages();

    for (let pi = 0; pi < n; pi++) {
      const page = doc.loadPage(pi);
      let st: import("mupdf").StructuredText | null = null;
      let device: import("mupdf").Device | null = null;
      try {
        const [bx0, by0, bx1, by1] = page.getBounds();
        const ox = bx0;
        const oy = by0;
        const width = bx1 - bx0;
        const height = by1 - by0;

        // ---- text: per-glyph chars via the structured-text walker ----
        // Keep mupdf's reading order and tag each char with its line id. Thai stacks
        // tone marks / vowels as combining glyphs at ~the base x; a global x-sort
        // would scramble them (ฮ้ือ → ฮือ ้), so words are grouped per-line in this
        // order rather than re-sorted.
        const chars: Char[] = [];
        let lineId = 0;
        st = page.toStructuredText("preserve-whitespace");
        st.walk({
          beginLine() {
            lineId++;
          },
          onChar(c, _origin, _font, size, quad) {
            const xs = [quad[0], quad[2], quad[4], quad[6]];
            const ys = [quad[1], quad[3], quad[5], quad[7]];
            const bottom = Math.max(...ys) - oy;
            // pdfplumber's char box height equals the font size (top = bottom - size);
            // mupdf's glyph quad is ~1.8pt taller, so anchor on the (matching) bottom
            // and derive top from size to keep byte-parity with the golden anchors.
            chars.push({
              text: c,
              x0: Math.min(...xs) - ox,
              x1: Math.max(...xs) - ox,
              top: bottom - size,
              bottom,
              size,
              line: lineId,
            });
          },
        });

        // ---- vector paths via a scriptable device ----
        const raw: RawShape[] = [];
        const collect = (
          path: import("mupdf").Path,
          ctm: import("mupdf").Matrix,
          color: number[],
          fill: boolean,
          stroke: boolean,
        ) => {
          const nsc = fill ? rawColor(color) : null;
          let sub: [number, number][] = [];
          let hasCurve = false;
          const flush = () => {
            if (sub.length < 2) {
              sub = [];
              hasCurve = false;
              return;
            }
            const { kind } = classify(sub, hasCurve);
            const xs = sub.map((p) => p[0]);
            const ys = sub.map((p) => p[1]);
            raw.push({
              kind,
              x0: Math.min(...xs) - ox,
              x1: Math.max(...xs) - ox,
              top: Math.min(...ys) - oy,
              bottom: Math.max(...ys) - oy,
              fill,
              stroke,
              nsc,
            });
            sub = [];
            hasCurve = false;
          };
          path.walk({
            moveTo(x, y) {
              flush();
              sub.push(apply(ctm, x, y));
            },
            lineTo(x, y) {
              sub.push(apply(ctm, x, y));
            },
            curveTo(x1, y1, x2, y2, x3, y3) {
              hasCurve = true;
              sub.push(apply(ctm, x1, y1));
              sub.push(apply(ctm, x2, y2));
              sub.push(apply(ctm, x3, y3));
            },
            closePath() {
              if (sub.length) sub.push(sub[0]);
            },
          });
          flush();
        };

        device = new mupdf.Device({
          fillPath(path, _evenOdd, ctm, _cs, color) {
            collect(path, ctm, color, true, false);
          },
          strokePath(path, _stroke, ctm, _cs, color) {
            collect(path, ctm, color, false, true);
          },
        });
        // Content stream ONLY — exclude annotation/widget appearances. pdfplumber
        // never saw form-field circles/boxes (they live in annotations, not page
        // content); rendering them here would invent phantom checkboxes on AcroForm
        // PDFs. runPageContents matches pdfplumber's scope.
        page.runPageContents(device, IDENTITY);
        device.close();

        const { lines, rects, curves } = binShapes(raw);

        pages.push({
          index: pi,
          width: round(width, 2),
          height: round(height, 2),
          words: buildWords(chars),
          chars,
          lines,
          rects,
          curves,
        });
      } finally {
        st?.destroy();
        device?.destroy();
        page.destroy();
      }
    }
  } finally {
    doc.destroy();
  }

  return pages;
}

/**
 * Split raw shapes into lines/rects/curves and merge a fill+stroke pair of the
 * same geometry (a PDF `B` op fires both callbacks) into one rect carrying both
 * flags — pdfplumber emits a single object per painted path.
 */
function binShapes(raw: RawShape[]): {
  lines: Line[];
  rects: Rect[];
  curves: Curve[];
} {
  const lines: Line[] = [];
  const curves: Curve[] = [];
  const rectMap = new Map<string, Rect>();

  for (const s of raw) {
    if (s.kind === "line") {
      lines.push({ x0: s.x0, x1: s.x1, top: s.top, bottom: s.bottom });
    } else if (s.kind === "curve") {
      curves.push({ x0: s.x0, x1: s.x1, top: s.top, bottom: s.bottom });
    } else {
      const key = bboxKey(s.x0, s.x1, s.top, s.bottom);
      const prev = rectMap.get(key);
      if (prev) {
        prev.fill = prev.fill || s.fill;
        prev.stroke = prev.stroke || s.stroke;
        if (prev.non_stroking_color == null && s.nsc != null)
          prev.non_stroking_color = s.nsc;
      } else {
        rectMap.set(key, {
          x0: s.x0,
          x1: s.x1,
          top: s.top,
          bottom: s.bottom,
          fill: s.fill,
          stroke: s.stroke,
          non_stroking_color: s.nsc,
        });
      }
    }
  }
  return { lines, rects: [...rectMap.values()], curves };
}

/**
 * Group chars into words approximating pdfplumber's `extract_words`: walk each
 * mupdf line in reading order (preserving Thai combining-mark order) and split
 * on whitespace, an x-gap, or a font-size change (Python passes
 * extra_attrs=['size']). Words are emitted left→right within a line so the
 * label heuristics that sort by x0 behave the same.
 */
function buildWords(chars: Char[]): Word[] {
  const X_TOL = 3;
  const words: Word[] = [];

  // bucket chars by mupdf line id, preserving per-line reading order
  const byLine = new Map<number, Char[]>();
  for (const c of chars) {
    const arr = byLine.get(c.line) ?? [];
    arr.push(c);
    byLine.set(c.line, arr);
  }

  let cur: Char[] = [];
  const flush = () => {
    if (!cur.length) return;
    words.push({
      text: cur.map((c) => c.text).join(""),
      x0: Math.min(...cur.map((c) => c.x0)),
      x1: Math.max(...cur.map((c) => c.x1)),
      top: Math.min(...cur.map((c) => c.top)),
      bottom: Math.max(...cur.map((c) => c.bottom)),
      size: cur[0].size,
    });
    cur = [];
  };

  for (const lineChars of byLine.values()) {
    let prev: Char | null = null;
    for (const c of lineChars) {
      if (c.text.trim() === "") {
        flush();
        prev = null;
        continue;
      }
      if (prev) {
        const gap = c.x0 - prev.x1;
        const sizeChange = Math.abs(c.size - prev.size) > 0.5;
        if (gap > X_TOL || sizeChange) flush();
      }
      cur.push(c);
      prev = c;
    }
    flush();
  }
  // left→right within each row, like pdfplumber's word ordering
  words.sort((a, b) => a.top - b.top || a.x0 - b.x0);
  return words;
}
