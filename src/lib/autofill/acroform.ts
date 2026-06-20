import fs from "node:fs/promises";
import { acroformInspect } from "./pdf/acroform-engine";
import { RawAcro, type AcroButton, type AcroResult, type AcroText } from "./schemas";

/**
 * Run acroform_fields.py and normalise into text fields (stamped on their /Rect)
 * and button groups (radio/checkbox, options ordered left→right by column).
 * Only fields with usable geometry are kept. Used for the AcroForm overlay path
 * (Thai-safe: we never fill via pypdf, whose /DA font tofus Thai — see D3).
 */
export async function inspectAcroform(
  pdfPath: string,
  outPath: string,
): Promise<AcroResult> {
  "use step";
  const bytes = new Uint8Array(await fs.readFile(pdfPath));
  const data = await acroformInspect(pdfPath, bytes);
  // Persist acroform.json for debug parity with the old Python engine.
  await fs.writeFile(outPath, JSON.stringify(data, null, 2), "utf8");
  const raw = RawAcro.parse(data);

  const texts: AcroText[] = [];
  const buttons: AcroButton[] = [];
  for (const f of raw.fields) {
    if (f.ft === "/Btn") {
      if (!f.options.length) continue;
      buttons.push({
        name: f.name,
        page: f.page,
        label: f.label.trim(),
        options: f.options.map((o) => ({
          onState: o.on_state,
          page: o.page,
          cx: o.cx,
          cy: o.cy,
          w: o.w,
          h: o.h,
        })),
      });
    } else if (f.rect && f.rect.length === 4) {
      const [x0, y0, x1, y1] = f.rect;
      texts.push({ name: f.name, page: f.page, label: f.label.trim(), rect: [x0, y0, x1, y1] });
    }
  }
  return { texts, buttons };
}
