import type { RunEvent } from "./workflow";

/**
 * Encode a stream of `RunEvent` objects (as read from `run.getReadable()`) into
 * NDJSON bytes for an HTTP response — one JSON object per line. The client reads
 * with `TextDecoder` + `split("\n")` + `JSON.parse`.
 */
export function ndjsonEncode(): TransformStream<RunEvent, Uint8Array> {
  const enc = new TextEncoder();
  return new TransformStream<RunEvent, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(enc.encode(JSON.stringify(chunk) + "\n"));
    },
  });
}
