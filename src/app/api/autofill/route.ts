import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { jobDir } from "@/lib/autofill/python";
import { runWorkflow } from "@/lib/autofill/run";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Upload a PDF and stream the fill workflow as NDJSON (one event per line). */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (
    file.type !== "application/pdf" &&
    !file.name.toLowerCase().endsWith(".pdf")
  ) {
    return Response.json({ error: "File must be a PDF" }, { status: 400 });
  }

  const jobId = randomUUID();
  const dir = await jobDir(jobId);
  const stem =
    file.name.replace(/\.pdf$/i, "").replace(/[/\\]/g, "_").trim() || "form";
  const pdfPath = path.join(dir, "in.pdf");
  await fs.writeFile(pdfPath, Buffer.from(await file.arrayBuffer()));
  await fs.writeFile(
    path.join(dir, "meta.json"),
    JSON.stringify({ stem, downloadName: `${stem}_Filled.pdf` }),
  );

  const encoder = new TextEncoder();
  const line = (ev: unknown) => encoder.encode(JSON.stringify(ev) + "\n");
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const ev of runWorkflow(jobId, pdfPath, stem)) {
          controller.enqueue(line(ev));
        }
      } catch (e) {
        controller.enqueue(
          line({
            type: "error",
            message: e instanceof Error ? e.message : String(e),
          }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
