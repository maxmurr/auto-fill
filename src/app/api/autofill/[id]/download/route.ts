import fs from "node:fs/promises";
import path from "node:path";
import { jobDirPath } from "@/lib/autofill/engine";

export const runtime = "nodejs";

/** Stream the filled PDF for a completed job as a download. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!/^[a-f0-9-]+$/i.test(id)) {
    return new Response("Bad job id", { status: 400 });
  }

  const dir = jobDirPath(id);
  let meta: { downloadName: string };
  try {
    meta = JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8"));
  } catch {
    return new Response("Job not found", { status: 404 });
  }

  let bytes: Buffer;
  try {
    // basename() keeps the read inside `dir` regardless of how meta was written.
    bytes = await fs.readFile(path.join(dir, path.basename(meta.downloadName)));
  } catch {
    return new Response("Filled PDF not found", { status: 404 });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        meta.downloadName,
      )}`,
      "cache-control": "no-store",
    },
  });
}
