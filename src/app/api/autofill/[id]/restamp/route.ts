import type { NextRequest } from "next/server";
import { restamp } from "@/lib/autofill/restamp";

export const runtime = "nodejs";
// Re-stamp re-runs the overlay + a single re-render; quick, but bound it anyway
// on platforms that cap function duration.
export const maxDuration = 120;

/**
 * Re-fill a completed job with edited text values. Body: `{ edits: { [id]: value } }`
 * keyed by the preview-row id the review UI holds. Returns the refreshed result
 * (`fields_filled`, `boxes_ticked`, `pages`, `preview`); the job's filled PDF and
 * preview PNGs are overwritten in place, so download/preview reflect the edits
 * (clients should cache-bust those URLs).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!/^[a-f0-9-]+$/i.test(id)) {
    return Response.json({ error: "Bad job id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = (body as { edits?: unknown })?.edits;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return Response.json({ error: "Missing edits object" }, { status: 400 });
  }

  // Keep only string values — a malformed entry shouldn't poison the fill.
  const edits: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") edits[k] = v;
  }

  try {
    return Response.json(await restamp(id, edits));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // The job dir / state.json lives in OS tmp and may have been reaped.
    if (/ENOENT/.test(msg)) {
      return Response.json({ error: "Job expired" }, { status: 404 });
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
