/**
 * Pure-TS port of `acroform_fields.py` — extracts AcroForm field geometry for the
 * overlay path: text/choice fields with their `/Rect`, and button groups (radio /
 * checkbox) with each option's centre + size + on-state. Emits the SAME JSON
 * shape the Python script did (`schemas.ts:RawAcro`).
 *
 * Geometry comes from pdf-lib's form widgets; nearby-label text reuses the
 * mupdf word extraction (same source as `inspect-engine.ts`). Coordinates are
 * PDF points, origin bottom-left (matches `overlay-engine.ts`).
 */
import { PDFDocument, PDFName, PDFRef, PDFDict } from "pdf-lib";
import { extractPages, type Word } from "./mupdf-extract";
import { r1 } from "./round";

type RawAcroOption = {
  page: number;
  on_state: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
};
type RawAcroField = {
  name: string;
  ft: string;
  page: number;
  label: string;
  rect: [number, number, number, number] | null;
  options: RawAcroOption[];
};
export type RawAcroData = {
  src: string;
  pages: { index: number; width: number; height: number }[];
  fields: RawAcroField[];
};

/** Map a pdf-lib field class to its PDF /FT name. */
function fieldType(ctor: string): string {
  switch (ctor) {
    case "PDFCheckBox":
    case "PDFRadioGroup":
    case "PDFButton":
      return "/Btn";
    case "PDFDropdown":
    case "PDFOptionList":
      return "/Ch";
    case "PDFSignature":
      return "/Sig";
    default:
      return "/Tx";
  }
}

export async function acroformInspect(
  pdfPath: string,
  bytes: Uint8Array,
): Promise<RawAcroData> {
  // Independent parses of the same bytes (mupdf vs pdf-lib) — run concurrently.
  const [extracted, doc] = await Promise.all([
    extractPages(bytes),
    PDFDocument.load(bytes, { ignoreEncryption: true }),
  ]);
  const pages = doc.getPages();

  // page ref -> index, to locate each widget's page
  const pageIndex = new Map<PDFRef, number>();
  pages.forEach((pg, i) => pageIndex.set(pg.ref, i));

  // Authoritative widget->page map by walking each page's /Annots, like the
  // Python extractor did. A widget's /P page ref is optional; valid multi-page
  // forms sometimes omit it, and defaulting those to page 0 would stamp every
  // field/tick onto page 1. /P is kept only as a fallback below.
  const pageByAnnot = new Map<PDFDict, number>();
  pages.forEach((pg, i) => {
    const annots = pg.node.Annots();
    if (!annots) return;
    for (let j = 0; j < annots.size(); j++) {
      const d = annots.lookup(j, PDFDict);
      if (d) pageByAnnot.set(d, i);
    }
  });

  const pagesMeta = extracted.map((p) => ({
    index: p.index,
    width: r1(p.width),
    height: r1(p.height),
  }));

  // per-page label finder over mupdf words (PDF bottom-left rect coords in)
  const labelForOnPage = (pi: number) => {
    const H = extracted[pi]?.height ?? 0;
    const words = extracted[pi]?.words ?? [];
    return (
      x0: number,
      y0: number,
      _x1: number,
      y1: number,
      band = 8,
      maxdx = 260,
    ): string => {
      const top = H - y1;
      const bottom = H - y0;
      const cy = (top + bottom) / 2;
      const picks = words.filter(
        (w: Word) =>
          Math.abs((w.top + w.bottom) / 2 - cy) < band &&
          w.x1 <= x0 + 2 &&
          x0 - w.x0 < maxdx,
      );
      picks.sort((a, b) => a.x0 - b.x0);
      return picks
        .map((w) => w.text)
        .join(" ")
        .slice(-80);
    };
  };

  const fields: RawAcroField[] = [];
  const form = doc.getForm();

  for (const field of form.getFields()) {
    const name = field.getName();
    const ft = fieldType(field.constructor.name);
    const rec: RawAcroField = {
      name,
      ft,
      page: 0,
      label: "",
      rect: null,
      options: [],
    };

    const widgets = field.acroField.getWidgets();
    for (const widget of widgets) {
      const rect = widget.getRectangle();
      const x0 = Math.min(rect.x, rect.x + rect.width);
      const x1 = Math.max(rect.x, rect.x + rect.width);
      const y0 = Math.min(rect.y, rect.y + rect.height);
      const y1 = Math.max(rect.y, rect.y + rect.height);
      const pi = widgetPage(widget.dict, pageIndex, pageByAnnot) ?? 0;
      const labelFor = labelForOnPage(pi);

      if (ft === "/Btn") {
        rec.options.push({
          page: pi,
          on_state: onState(widget),
          cx: r1((x0 + x1) / 2),
          cy: r1((y0 + y1) / 2),
          w: r1(x1 - x0),
          h: r1(y1 - y0),
        });
        if (!rec.label) rec.label = labelFor(x0, y0, x1, y1);
      } else {
        rec.rect = [r1(x0), r1(y0), r1(x1), r1(y1)];
        rec.page = pi;
        rec.label = labelFor(x0, y0, x1, y1);
      }
    }

    // order options left→right (physical column) per page
    rec.options.sort((a, b) => a.page - b.page || a.cx - b.cx);
    fields.push(rec);
  }

  return { src: pdfPath, pages: pagesMeta, fields };
}

/**
 * Resolve a widget's page index: prefer the page whose `/Annots` actually lists
 * this widget (authoritative, matches the Python extractor), and fall back to
 * the widget's optional `/P` ref. Returns undefined only when neither resolves.
 */
function widgetPage(
  dict: PDFDict,
  pageIndex: Map<PDFRef, number>,
  pageByAnnot: Map<PDFDict, number>,
): number | undefined {
  const viaAnnots = pageByAnnot.get(dict);
  if (viaAnnots !== undefined) return viaAnnots;
  const p = dict.get(PDFName.of("P"));
  if (p instanceof PDFRef) return pageIndex.get(p);
  return undefined;
}

/** A button widget's on-state name (the non-/Off `/AP /N` key), like "/Yes". */
function onState(widget: { getOnValue?: () => PDFName | undefined }): string {
  try {
    const on = widget.getOnValue?.();
    if (on) {
      const s = on.toString();
      return s.startsWith("/") ? s : `/${s}`;
    }
  } catch {
    /* fall through */
  }
  return "/On";
}
