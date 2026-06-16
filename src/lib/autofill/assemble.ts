import type { InspectResult, Suggestion } from "./schemas";

export type OverlayItem =
  | {
      page: number;
      kind: "text";
      x: number;
      baseline: number;
      text: string;
      font: string;
      size: number;
    }
  | { page: number; kind: "check"; cx: number; cy: number; size: number; font: string };

export type OverlaySpec = { src: string; out: string; items: OverlayItem[] };

export type Assembled = {
  spec: OverlaySpec;
  preview: { label: string; value: string }[];
  fieldsFilled: number;
  boxesTicked: number;
};

/** Turn anchor coords + model suggestions into an overlay_fill.py spec. */
export function assemble(
  ins: InspectResult,
  sug: Suggestion,
  src: string,
  out: string,
): Assembled {
  const fieldById = new Map(ins.fields.map((f) => [f.id, f]));
  const boxById = new Map(ins.checkboxes.map((c) => [c.id, c]));

  const textItems: OverlayItem[] = [];
  const preview: { label: string; value: string }[] = [];
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
    preview.push({ label: f.label, value: v.value });
  }

  // De-dupe chosen boxes (model may repeat) and stamp one tick each.
  const seen = new Set<string>();
  const checkItems: OverlayItem[] = [];
  for (const ch of sug.checks) {
    const c = boxById.get(ch.id);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    checkItems.push({
      page: c.page,
      kind: "check",
      cx: c.cx,
      cy: c.cy,
      size: 10,
      font: "thai",
    });
  }

  return {
    spec: { src, out, items: [...textItems, ...checkItems] },
    preview,
    fieldsFilled: textItems.length,
    boxesTicked: checkItems.length,
  };
}
