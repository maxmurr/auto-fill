import fs from "node:fs/promises";
import path from "node:path";
import { jobDirPath } from "@/lib/autofill/python";

export const runtime = "nodejs";

/** Serve a rendered verify page (PNG) for a completed job. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; n: string }> },
) {
  const { id, n } = await ctx.params;
  if (!/^[a-f0-9-]+$/i.test(id)) {
    return new Response("Bad job id", { status: 400 });
  }
  if (!/^\d+$/.test(n)) {
    return new Response("Bad page number", { status: 400 });
  }

  const dir = jobDirPath(id);
  let bytes: Buffer;
  try {
    // pdftoppm names pages verify-1.png, verify-2.png, … (1-based).
    bytes = await fs.readFile(path.join(dir, `verify-${Number(n)}.png`));
  } catch {
    return new Response("Preview not found", { status: 404 });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "image/png",
      "cache-control": "no-store",
    },
  });
}
