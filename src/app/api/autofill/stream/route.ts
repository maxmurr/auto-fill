import { getRun } from "workflow/api";
import { ndjsonEncode } from "@/lib/autofill/ndjson";

export const runtime = "nodejs";
// This request stays open while the run streams, so it inherits the long-fill
// allowance the old POST route carried. Ignored by `next start` (no cap),
// honoured by platforms that bound function duration.
export const maxDuration = 300;

/**
 * Stream a run's progress as NDJSON. `startIndex` (default 0) replays the
 * durable event log from that position, so a reconnecting client rebuilds its
 * UI from scratch. Negative values read relative to the end of the stream.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const runId = url.searchParams.get("runId");
  if (!runId) return new Response("Missing runId", { status: 400 });

  // A non-numeric param (e.g. `?startIndex=abc`) parses to NaN, which silently
  // disables the SDK's reconnect path and replays nothing — so fall back to 0.
  // Finite negatives are valid (read relative to the end of the log).
  const parsed = Number(url.searchParams.get("startIndex"));
  const startIndex = Number.isFinite(parsed) ? Math.trunc(parsed) : 0;

  const run = getRun(runId);
  if (!(await run.exists)) return new Response("Run not found", { status: 404 });

  const stream = run.getReadable({ startIndex }).pipeThrough(ndjsonEncode());
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-workflow-run-id": runId,
      "cache-control": "no-store",
    },
  });
}
