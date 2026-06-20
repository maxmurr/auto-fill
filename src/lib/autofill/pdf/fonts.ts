/**
 * Vendored overlay fonts. The Python engine pointed at macOS system TTFs
 * (Tahoma / Arial) that don't exist on a Linux deploy — every fill would fall
 * back to Helvetica and tofu Thai. We bundle Sarabun (OFL), which covers Thai +
 * Latin, and embed it via fontkit. Override the directory with
 * AUTOFILL_FONTS_DIR if the bundle lives elsewhere at deploy time.
 */
import fs from "node:fs/promises";
import path from "node:path";

const FONTS_DIR =
  process.env.AUTOFILL_FONTS_DIR ||
  path.join(process.cwd(), "src", "lib", "autofill", "fonts");

export type FontWeight = "regular" | "bold";

/** Map an overlay font role to a Sarabun weight. */
export function roleWeight(role: string | undefined): FontWeight {
  return role && role.endsWith("-bold") ? "bold" : "regular";
}

/** Read the Sarabun TTF bytes for both weights. */
export async function loadFontBytes(): Promise<Record<FontWeight, Uint8Array>> {
  const [regular, bold] = await Promise.all([
    fs.readFile(path.join(FONTS_DIR, "Sarabun-Regular.ttf")),
    fs.readFile(path.join(FONTS_DIR, "Sarabun-Bold.ttf")),
  ]);
  return { regular: new Uint8Array(regular), bold: new Uint8Array(bold) };
}
