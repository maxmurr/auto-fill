/**
 * Pure-TS replacement for `qpdf --flatten-annotations=all`. A radio/checkbox
 * widget draws its circle as an appearance stream ABOVE page content, so an
 * overlay tick at the circle centre gets painted over (the 19_E bug). Flattening
 * bakes the (empty) widget appearances into the page and removes the
 * interactivity, so a later overlay sits on top.
 *
 * pdf-lib's `form.flatten()` does exactly this for AcroForm fields; the forms we
 * flatten are blank, so it bakes the empty box/circle outlines without rendering
 * any value (no Thai /DA tofu).
 */
import fs from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

export async function flattenPdf(src: string, out: string): Promise<string> {
  const bytes = await fs.readFile(src);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });

  // Only the "no AcroForm at all" case is benign — save as-is. When a form IS
  // present, a flatten() failure must NOT be swallowed: saving the document
  // unflattened silently re-introduces the widget-occlusion bug this function
  // exists to fix (overlay tick hidden under the radio circle). Let it throw so
  // the workflow step fails loudly instead of shipping an occluded PDF.
  let hasFields = false;
  try {
    hasFields = doc.getForm().getFields().length > 0;
  } catch {
    hasFields = false;
  }
  if (hasFields) doc.getForm().flatten();

  const saved = await doc.save();
  await fs.writeFile(out, Buffer.from(saved));
  return out;
}
