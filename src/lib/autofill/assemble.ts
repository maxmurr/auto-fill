import type {
  AcroResult,
  AcroSuggestion,
  InspectResult,
  Suggestion,
  Table,
} from "./schemas";

export type OverlayItem =
  | {
      page: number;
      kind: "text";
      x: number;
      baseline: number;
      text: string;
      font: string;
      size: number;
      align?: "left" | "center" | "right";
    }
  | {
      page: number;
      kind: "check";
      cx: number;
      cy: number;
      size: number;
      font: string;
      mark?: string;
      w?: number;
      h?: number;
    };

export type OverlaySpec = { src: string; out: string; items: OverlayItem[] };

/**
 * A row in the "what was filled" summary. `kind:"text"` rows carry the source
 * field/AcroForm `id` so the review UI can edit them and re-stamp by id;
 * `kind:"check"` rows (ticked boxes, table marks) are read-only.
 */
export type PreviewRow = {
  id?: string;
  label: string;
  value: string;
  kind: "text" | "check";
};

export type Assembled = {
  spec: OverlaySpec;
  preview: PreviewRow[];
  fieldsFilled: number;
  boxesTicked: number;
};

const isThai = (s: string) => /[฀-๿]/.test(s);
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** Turn anchor coords + model suggestions into an overlay_fill.py spec. */
export function assemble(
  ins: InspectResult,
  sug: Suggestion,
  src: string,
  out: string,
): Assembled {
  const fieldById = new Map(ins.fields.map((f) => [f.id, f]));
  const boxById = new Map(ins.checkboxes.map((c) => [c.id, c]));
  const rowById = new Map(
    ins.tables.flatMap((t) => t.rows.map((r) => [r.id, r] as const)),
  );
  const colById = new Map(
    ins.tables.flatMap((t: Table) =>
      t.columns.map((c) => [c.id, c] as const),
    ),
  );

  const textItems: OverlayItem[] = [];
  const checkItems: OverlayItem[] = [];
  const preview: PreviewRow[] = [];

  for (const v of sug.values) {
    const f = fieldById.get(v.id);
    if (!f || !v.value.trim()) continue;
    textItems.push({
      page: f.page,
      kind: "text",
      x: f.x,
      baseline: f.baseline,
      text: v.value,
      font: v.font,
      size: 8.5,
    });
    preview.push({ id: f.id, label: f.label, value: v.value, kind: "text" });
  }

  // De-dupe chosen boxes (model may repeat) and stamp one tick each, sized to
  // the detected box so the mark lands inside it.
  const seen = new Set<string>();
  for (const ch of sug.checks) {
    const c = boxById.get(ch.id);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    checkItems.push({
      page: c.page,
      kind: "check",
      cx: c.cx,
      cy: c.cy,
      size: clamp(c.size, 8, 14),
      font: "thai",
    });
    if (c.label) preview.push({ label: c.label, value: "✓", kind: "check" });
  }

  // Table cells: tick a ✓ in an option column, or write a word centered in a
  // single combined answer column.
  const seenCell = new Set<string>();
  for (const m of sug.tableMarks) {
    const r = rowById.get(m.rowId);
    const col = colById.get(m.columnId);
    if (!r || !col) continue;
    const key = `${m.rowId}:${m.columnId}`;
    if (seenCell.has(key)) continue;
    seenCell.add(key);

    if (m.mark === "text" && m.text.trim()) {
      const size = 9;
      textItems.push({
        page: r.page,
        kind: "text",
        x: col.cx,
        baseline: r.cy - size * 0.33,
        text: m.text,
        font: isThai(m.text) ? "thai" : "latin",
        size,
        align: "center",
      });
      preview.push({ label: r.label, value: m.text, kind: "check" });
    } else {
      checkItems.push({
        page: r.page,
        kind: "check",
        cx: col.cx,
        cy: r.cy,
        size: clamp(r.h, 8, 12),
        font: "thai",
        mark: "✓",
      });
      preview.push({ label: r.label, value: col.header || "✓", kind: "check" });
    }
  }

  return {
    spec: { src, out, items: [...textItems, ...checkItems] },
    preview,
    fieldsFilled: textItems.length,
    boxesTicked: checkItems.length,
  };
}

/**
 * Assemble an overlay for the AcroForm path: text values stamped on each field's
 * /Rect, radios/checkboxes ticked at the chosen option's column center. Stamped
 * onto the FLATTENED PDF (src) so widget appearances don't occlude the marks.
 */
export function assembleAcroform(
  acro: AcroResult,
  sug: AcroSuggestion,
  src: string,
  out: string,
): Assembled {
  const textByName = new Map(acro.texts.map((t) => [t.name, t]));
  const btnByName = new Map(acro.buttons.map((b) => [b.name, b]));

  const textItems: OverlayItem[] = [];
  const checkItems: OverlayItem[] = [];
  const preview: PreviewRow[] = [];

  for (const v of sug.texts) {
    const f = textByName.get(v.name);
    if (!f || !v.value.trim()) continue;
    const [x0, y0, , y1] = f.rect;
    const size = clamp(y1 - y0 - 3, 7, 11);
    textItems.push({
      page: f.page,
      kind: "text",
      x: x0 + 3,
      baseline: y0 + 3,
      text: v.value,
      font: v.font,
      size,
    });
    preview.push({ id: f.name, label: f.label || f.name, value: v.value, kind: "text" });
  }

  const seen = new Set<string>();
  for (const b of sug.buttons) {
    const f = btnByName.get(b.name);
    if (!f || !f.options.length || seen.has(b.name)) continue;
    seen.add(b.name);
    const opt = f.options[clamp(b.optionIndex, 0, f.options.length - 1)];
    checkItems.push({
      page: opt.page,
      kind: "check",
      cx: opt.cx,
      cy: opt.cy,
      size: clamp(Math.min(opt.w, opt.h), 8, 14),
      font: "thai",
      mark: "✓",
    });
    if (f.label) preview.push({ label: f.label, value: "✓", kind: "check" });
  }

  return {
    spec: { src, out, items: [...textItems, ...checkItems] },
    preview,
    fieldsFilled: textItems.length,
    boxesTicked: checkItems.length,
  };
}
