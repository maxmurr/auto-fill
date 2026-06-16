import { z } from "zod";

/** Raw shape emitted by pyscripts/inspect_pdf.py (extra keys are ignored). */
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
  label_right: z.string(),
});

export const RawPage = z.object({
  index: z.number(),
  width: z.number(),
  height: z.number(),
  blanks: z.array(RawBlank),
  checkboxes: z.array(RawCheckbox),
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
  label: string;
  /** group key — boxes sharing a row are mutually-exclusive options. */
  row: string;
};

export type InspectResult = {
  title: string;
  pages: { width: number; height: number }[];
  fields: Field[];
  checkboxes: Checkbox[];
  acroformCount: number;
};

/** Font roles understood by overlay_fill.py. */
export const FontRole = z.enum(["thai", "thai-bold", "latin", "latin-bold"]);

/** Structured output the model must return (one batched call). */
export const Suggestion = z.object({
  values: z.array(
    z.object({
      id: z.string(),
      value: z.string(),
      font: FontRole,
    }),
  ),
  checks: z.array(z.object({ id: z.string() })),
});
export type Suggestion = z.infer<typeof Suggestion>;
