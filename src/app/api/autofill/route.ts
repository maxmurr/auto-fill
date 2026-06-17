import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { start } from "workflow/api";
import { jobDir } from "@/lib/autofill/python";
import { isPdfUpload } from "@/lib/pdf";
import { fillWorkflow } from "@/lib/autofill/workflow";

export const runtime = "nodejs";

/**
 * Upload a PDF and start the durable fill workflow. Returns `{ runId, jobId }`
 * immediately — progress is streamed separately from `GET /api/autofill/stream`
 * so a client can disconnect/reconnect and replay the run's event log.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (!isPdfUpload(file)) {
    return Response.json({ error: "File must be a PDF" }, { status: 400 });
  }

  const jobId = randomUUID();
  const dir = await jobDir(jobId);
  const stem =
    file.name.replace(/\.pdf$/i, "").replace(/[/\\]/g, "_").trim() || "form";
  // The filled PDF's on-disk name is also its download name — stored once in
  // meta.json so the download route reads it back rather than re-deriving it.
  const downloadName = `${stem}_Filled.pdf`;
  const pdfPath = path.join(dir, "in.pdf");
  await fs.writeFile(pdfPath, Buffer.from(await file.arrayBuffer()));
  await fs.writeFile(
    path.join(dir, "meta.json"),
    JSON.stringify({ downloadName }),
  );

  // Paths are resolved here (normal Node) and passed as strings — the workflow
  // sandbox has no `node:path`.
  const run = await start(fillWorkflow, [
    {
      jobId,
      pdfPath,
      anchorsPath: path.join(dir, "anchors.json"),
      acroPath: path.join(dir, "acroform.json"),
      flatPath: path.join(dir, "flat.pdf"),
      fillsPath: path.join(dir, "fills.json"),
      outPath: path.join(dir, downloadName),
      dir,
      stem,
    },
  ]);

  return Response.json({ runId: run.runId, jobId });
}
