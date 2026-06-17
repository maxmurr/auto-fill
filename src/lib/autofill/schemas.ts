import { z } from "zod";

/** Raw shape emitted by inspect_pdf.py (extra keys are ignored). */
export const RawBlank = z.object({
  id: z.string(),
  suggest_x: z.number(),
  suggest_baseline: z.number(),
  label_left: z.string(),
});

export const RawCheckbox = z.object({
  id: z.string(),
  cx: z.number(),
  cy_pdf: z.number(),
  size: z.number().default(10),
  label_right: z.string(),
});

export const RawColumn = z.object({
  x0: z.number(),
  x1: z.number(),
  cx: z.number(),
  header: z.string().default(""),
});

export const RawRow = z.object({
  cy_pdf: z.number(),
  h: z.number(),
  grey: z.boolean().default(false),
  label_left: z.string().default(""),
});

export const RawTable = z.object({
  id: z.string(),
  columns: z.array(RawColumn),
  rows: z.array(RawRow),
});

export const RawPage = z.object({
  index: z.number(),
  width: z.number(),
  height: z.number(),
  blanks: z.array(RawBlank),
  checkboxes: z.array(RawCheckbox),
  // `tables` is newer than some cached anchors — default to empty for safety.
  tables: z.array(RawTable).default([]),
});

export const RawAnchors = z.object({
  src: z.string(),
  acroform_fields: z.array(z.unknown()),
  pages: z.array(RawPage),
});
export type RawAnchors = z.infer<typeof RawAnchors>;

/** Normalised, page-aware view consumed by the rest of the workflow. */
export type Field = {
  id: string;
  page: number;
  x: number;
  baseline: number;
  label: string;
};

export type Checkbox = {
  id: string;
  page: number;
  cx: number;
  cy: number;
  size: number;
  label: string;
  /** group key — boxes sharing a row are mutually-exclusive options. */
  row: string;
};

export type TableColumn = { id: string; cx: number; header: string };
export type TableRow = {
  id: string;
  page: number;
  cy: number;
  h: number;
  label: string;
};
export type Table = {
  id: string;
  page: number;
  columns: TableColumn[];
  rows: TableRow[];
};

export type InspectResult = {
  title: string;
  pages: { width: number; height: number }[];
  fields: Field[];
  checkboxes: Checkbox[];
  tables: Table[];
  acroformCount: number;
};

/** Font roles understood by overlay_fill.py. */
export const FontRole = z.enum(["thai", "thai-bold", "latin", "latin-bold"]);

/**
 * Structured output for the overlay path (one batched call): a value per text
 * blank, one ticked box per checkbox row, and a mark per answerable table row.
 */
export const Suggestion = z.object({
  values: z.array(
    z.object({
      id: z.string(),
      value: z.string(),
      font: FontRole,
    }),
  ),
  checks: z.array(z.object({ id: z.string() })),
  tableMarks: z
    .array(
      z.object({
        rowId: z.string(),
        columnId: z.string(),
        /** "tick" → stamp a ✓ in the cell; "text" → write `text` centered in it. */
        mark: z.enum(["tick", "text"]),
        text: z.string().default(""),
      }),
    )
    .default([]),
});
export type Suggestion = z.infer<typeof Suggestion>;

/** Raw shape emitted by acroform_fields.py. */
export const RawAcroOption = z.object({
  page: z.number(),
  on_state: z.string(),
  cx: z.number(),
  cy: z.number(),
  w: z.number(),
  h: z.number(),
});
export const RawAcroField = z.object({
  name: z.string(),
  ft: z.string(),
  page: z.number(),
  label: z.string().default(""),
  rect: z.array(z.number()).nullable().default(null),
  options: z.array(RawAcroOption).default([]),
});
export const RawAcro = z.object({
  src: z.string(),
  pages: z.array(z.object({ index: z.number(), width: z.number(), height: z.number() })),
  fields: z.array(RawAcroField),
});
export type RawAcro = z.infer<typeof RawAcro>;

export type AcroText = {
  name: string;
  page: number;
  label: string;
  rect: [number, number, number, number];
};
export type AcroOption = {
  onState: string;
  page: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
};
export type AcroButton = {
  name: string;
  page: number;
  label: string;
  options: AcroOption[];
};
export type AcroResult = { texts: AcroText[]; buttons: AcroButton[] };

/**
 * Structured output for the AcroForm path: a value per text field, and the
 * chosen option (by physical-column index, left→right) per button group.
 */
export const AcroSuggestion = z.object({
  texts: z.array(
    z.object({ name: z.string(), value: z.string(), font: FontRole }),
  ),
  buttons: z.array(
    z.object({ name: z.string(), optionIndex: z.number().int().min(0) }),
  ),
});
export type AcroSuggestion = z.infer<typeof AcroSuggestion>;
