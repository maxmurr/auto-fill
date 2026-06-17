import fs from "node:fs/promises";
import { runPy } from "./python";
import {
  RawAnchors,
  type Checkbox,
  type Field,
  type InspectResult,
  type Table,
} from "./schemas";

/**
 * Run inspect_pdf.py and normalise its output across all pages.
 * - Blanks with an empty label_left are treated as decorative (header bars,
 *   underlines, signature rules) and dropped.
 * - Checkboxes are grouped into rows by vertical proximity (per page); boxes in
 *   the same row are mutually-exclusive options.
 * - Rect-grid tables (scoring / Yes-No matrices) become {columns, rows}: grey
 *   header/section bands and label-less rows are dropped so only answerable rows
 *   remain. The model later picks one column per row to mark.
 */
export async function inspect(
  pdfPath: string,
  anchorsPath: string,
  title: string,
): Promise<InspectResult> {
  "use step";
  await runPy("inspect_pdf.py", [pdfPath, anchorsPath]);
  const raw = RawAnchors.parse(
    JSON.parse(await fs.readFile(anchorsPath, "utf8")),
  );

  const fields: Field[] = [];
  const checkboxes: Checkbox[] = [];
  const tables: Table[] = [];

  for (const pg of raw.pages) {
    for (const b of pg.blanks) {
      const label = b.label_left.trim();
      if (!label) continue; // decorative — no preceding label to answer against
      fields.push({
        id: b.id,
        page: pg.index,
        x: b.suggest_x,
        baseline: b.suggest_baseline,
        label,
      });
    }

    // Group by descending y; start a new row when y drops more than 8pt.
    const sorted = [...pg.checkboxes].sort((a, b) => b.cy_pdf - a.cy_pdf);
    let rowNum = -1;
    let lastCy = Infinity;
    for (const c of sorted) {
      if (lastCy - c.cy_pdf > 8) rowNum++;
      lastCy = c.cy_pdf;
      checkboxes.push({
        id: c.id,
        page: pg.index,
        cx: c.cx,
        cy: c.cy_pdf,
        size: c.size,
        label: c.label_right.trim(),
        row: `p${pg.index}r${rowNum}`,
      });
    }

    for (const t of pg.tables) {
      const columns = t.columns.map((c, i) => ({
        id: `${t.id}c${i}`,
        cx: c.cx,
        header: c.header.trim(),
      }));
      const rows = t.rows
        .map((r, i) => ({ raw: r, id: `${t.id}r${i}` }))
        .filter(({ raw }) => !raw.grey && raw.label_left.trim())
        .map(({ raw, id }) => ({
          id,
          page: pg.index,
          cy: raw.cy_pdf,
          h: raw.h,
          label: raw.label_left.trim(),
        }));
      if (columns.length >= 2 && rows.length) {
        tables.push({ id: t.id, page: pg.index, columns, rows });
      }
    }
  }

  const acroformCount = raw.acroform_fields.filter(
    (f) => f && typeof f === "object" && "name" in (f as object),
  ).length;

  return {
    title,
    pages: raw.pages.map((p) => ({ width: p.width, height: p.height })),
    fields,
    checkboxes,
    tables,
    acroformCount,
  };
}
