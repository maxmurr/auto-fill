import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

/**
 * Deterministic PDF mechanics for the fill pipeline — now pure TypeScript.
 *
 * This used to shell out to the `auto-fill-pdf` skill's Python scripts
 * (pdfplumber / pypdf / reportlab) plus the `qpdf` and `pdftoppm` CLIs, so a
 * deploy needed Python, poppler, qpdf and macOS-only fonts on PATH. The engine
 * now runs on mupdf (WASM) + pdf-lib + a vendored Sarabun font, so the app runs
 * on a stock Node container with zero system dependencies.
 *
 * - inspect / acroform geometry → `./pdf/inspect-engine`, `./pdf/acroform-engine`
 * - overlay stamping            → `./pdf/overlay-engine`
 * - flatten (was qpdf)          → `./pdf/flatten`  (re-exported below)
 * - render to PNG (was pdftoppm)→ `./pdf/render`   (re-exported below)
 */
export { flattenPdf } from "./pdf/flatten";
export { renderPdf } from "./pdf/render";

/**
 * Verify-preview render contract, defined once. The workflow render step and the
 * re-stamp route write `${VERIFY_PREFIX}-<n>.png` at PREVIEW_DPI; the preview
 * route reads back the same names. Keeping the prefix + dpi here stops those
 * three call sites from drifting apart.
 */
export const VERIFY_PREFIX = "verify";
export const PREVIEW_DPI = 150;

/** Canonical per-job directory path under the OS temp dir (does not create it). */
export function jobDirPath(id: string): string {
  return path.join(os.tmpdir(), "autofill", id);
}

/** Per-job working directory under the OS temp dir (created if missing). */
export async function jobDir(id: string): Promise<string> {
  const dir = jobDirPath(id);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
