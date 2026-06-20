/**
 * Pure-TS replacement for `pdftoppm` (poppler). Renders each page to a PNG via
 * mupdf and writes `<prefix>-<n>.png` (1-based, matching pdftoppm's naming so
 * the preview route's `verify-<n>.png` contract is unchanged). Returns the PNG
 * paths in page order.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { loadMupdf } from "./mupdf-extract";

export async function renderPdf(
  pdf: string,
  dir: string,
  prefix: string,
  dpi = 150,
): Promise<string[]> {
  const mupdf = await loadMupdf();
  const bytes = new Uint8Array(await fs.readFile(pdf));
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const scale = dpi / 72;
  const out: string[] = [];

  // Free the native WASM handles explicitly (page + pixmap per page, document
  // overall) on success and throw alike, so repeated renders don't leak the
  // WASM heap → OOM on a long-lived server.
  try {
    const n = doc.countPages();
    for (let i = 0; i < n; i++) {
      const page = doc.loadPage(i);
      let pix: import("mupdf").Pixmap | null = null;
      try {
        pix = page.toPixmap(
          mupdf.Matrix.scale(scale, scale),
          mupdf.ColorSpace.DeviceRGB,
          false,
        );
        const png = pix.asPNG();
        const p = path.join(dir, `${prefix}-${i + 1}.png`);
        await fs.writeFile(p, Buffer.from(png));
        out.push(p);
      } finally {
        pix?.destroy();
        page.destroy();
      }
    }
  } finally {
    doc.destroy();
  }
  return out;
}
