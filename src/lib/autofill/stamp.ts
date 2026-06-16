import fs from "node:fs/promises";
import { runPy } from "./python";
import type { OverlaySpec } from "./assemble";

/** Persist the fills spec, run overlay_fill.py, return the output PDF path. */
export async function stamp(
  spec: OverlaySpec,
  fillsPath: string,
): Promise<string> {
  await fs.writeFile(fillsPath, JSON.stringify(spec, null, 2), "utf8");
  await runPy("overlay_fill.py", [fillsPath]);
  return spec.out;
}
