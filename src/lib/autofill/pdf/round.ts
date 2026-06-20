/**
 * Shared coordinate rounding for the PDF engine. The emitted-JSON quantum is a
 * cross-module contract — inspect-engine, acroform-engine and mupdf-extract all
 * round coordinates the same way so the inspect path and the AcroForm path can't
 * drift out of alignment. Keep the single definition here rather than copies.
 */

/** Round `v` to `d` decimal places. */
export const round = (v: number, d: number): number => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

/** Round to 1 decimal place (0.1pt) — the standard anchor-coordinate quantum. */
export const r1 = (v: number): number => round(v, 1);

/** Round to the nearest integer — used for dedup/sort keys. */
export const ri = (v: number): number => Math.round(v);

/**
 * Integer dedup/merge key for a shape bbox: round each coordinate and join. Used
 * to collapse near-coincident shapes (checkbox squares, fill+stroke rect pairs)
 * so the same painted region isn't emitted twice.
 */
export const bboxKey = (...coords: number[]): string =>
  coords.map((v) => Math.round(v)).join(":");
