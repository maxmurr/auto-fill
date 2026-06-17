import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

const PY = process.env.PYTHON_BIN || "python3";

/**
 * Single source of truth for the fill engine: the same Python scripts the
 * `auto-fill-pdf` skill ships. The web app and the skill ran divergent copies
 * for a while (the old `pyscripts/` lagged behind every Ralph-loop fix —
 * glyph/curve checkbox detection, rect-grid tables, text alignment), so the app
 * silently failed on whole form families. Pointing here keeps one engine.
 * Override with AUTOFILL_SCRIPTS_DIR if the skill lives elsewhere at deploy time.
 */
const SCRIPTS =
  process.env.AUTOFILL_SCRIPTS_DIR ||
  path.join(process.cwd(), ".claude", "skills", "auto-fill-pdf", "scripts");

/** Spawn a child process, resolving with stdout (rejects on non-zero exit). */
function runProc(cmd: string, args: string[], label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on("data", (d) => out.push(d));
    proc.stderr.on("data", (d) => err.push(d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      const stdout = Buffer.concat(out).toString();
      if (code === 0) return resolve(stdout);
      const stderr = Buffer.concat(err).toString();
      reject(new Error(`${label} exited ${code}: ${stderr || stdout}`));
    });
  });
}

/** Run a vendored python script from the skill's scripts dir; resolves with stdout. */
export function runPy(script: string, args: string[]): Promise<string> {
  return runProc(PY, [path.join(SCRIPTS, script), ...args], script);
}

/**
 * Flatten interactive annotations (AcroForm widgets) into static page content.
 * A radio/checkbox widget draws its circle as an appearance stream ABOVE page
 * content, so an overlay tick at the circle center gets painted over (only a tip
 * pokes out the top rim — the 19_E bug). Flattening first removes that occlusion;
 * the output is non-interactive, which is fine for a filled sample.
 */
export async function flattenPdf(src: string, out: string): Promise<string> {
  await runProc("qpdf", ["--flatten-annotations=all", src, out], "qpdf");
  return out;
}

/**
 * Render a PDF to PNGs at `dpi` into `dir` with the given basename prefix.
 * pdftoppm writes `<prefix>-1.png`, `<prefix>-2.png`, … — returns their absolute
 * paths in page order so the verify step can surface them in the UI.
 */
export async function renderPdf(
  pdf: string,
  dir: string,
  prefix: string,
  dpi = 150,
): Promise<string[]> {
  await runProc(
    "pdftoppm",
    ["-png", "-r", String(dpi), pdf, path.join(dir, prefix)],
    "pdftoppm",
  );
  const names = (await fs.readdir(dir))
    .filter((n) => n.startsWith(`${prefix}-`) && n.endsWith(".png"))
    .sort((a, b) => pageNum(a) - pageNum(b));
  return names.map((n) => path.join(dir, n));
}

/** Extract the 1-based page number pdftoppm appends, e.g. `out-12.png` → 12. */
function pageNum(name: string): number {
  const m = name.match(/-(\d+)\.png$/);
  return m ? Number(m[1]) : 0;
}

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
