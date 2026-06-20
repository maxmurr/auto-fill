import fs from "node:fs/promises";
import { overlayFill } from "./pdf/overlay-engine";
import type { OverlaySpec } from "./assemble";

/** Persist the fills spec (debug), run the overlay engine, return output PDF path. */
export async function stamp(
  spec: OverlaySpec,
  fillsPath: string,
): Promise<string> {
  "use step";
  await fs.writeFile(fillsPath, JSON.stringify(spec, null, 2), "utf8");
  await overlayFill(spec);
  return spec.out;
}
