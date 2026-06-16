import { getWritable } from "workflow";
import { inspect } from "./inspect";
import { suggestAnswers } from "./suggest";
import { assemble } from "./assemble";
import { stamp } from "./stamp";

/**
 * One event per phase, streamed to the run's default writable. `done` carries
 * everything the UI needs (incl. jobId for the download link), so a client that
 * replays the stream from index 0 rebuilds the full result without extra state.
 */
export type RunEvent =
  | { type: "phase"; phase: "inspect" | "suggest" | "assemble" | "stamp"; msg: string }
  | {
      type: "done";
      jobId: string;
      fields_filled: number;
      boxes_ticked: number;
      preview: { label: string; value: string }[];
    }
  | { type: "error"; message: string };

/**
 * All paths are pre-computed in the API route (normal Node) and passed in as
 * strings — the `"use workflow"` body runs in a sandbox without `node:path`.
 */
export type FillArgs = {
  jobId: string;
  pdfPath: string;
  anchorsPath: string;
  fillsPath: string;
  outPath: string;
  stem: string;
};

/** Write one event to the run's default stream. Streams can only be written from a step. */
async function emit(ev: RunEvent): Promise<void> {
  "use step";
  const writer = getWritable<RunEvent>().getWriter();
  try {
    await writer.write(ev);
  } finally {
    writer.releaseLock();
  }
}

/**
 * Durable fill pipeline: Inspect → Suggest → Assemble → Stamp. Each phase emits
 * a progress event; `inspect`/`suggestAnswers`/`stamp` are `"use step"` (full
 * Node — fs, python, AI SDK), while `assemble` is pure and runs inline here.
 * Errors emit a terminal `error` event then rethrow so the run is marked failed.
 */
export async function fillWorkflow(a: FillArgs): Promise<RunEvent> {
  "use workflow";
  try {
    await emit({ type: "phase", phase: "inspect", msg: "Inspecting form layout…" });
    const ins = await inspect(a.pdfPath, a.anchorsPath, a.stem);
    await emit({
      type: "phase",
      phase: "inspect",
      msg: `Found ${ins.fields.length} fields, ${ins.checkboxes.length} checkboxes${
        ins.acroformCount ? ` (${ins.acroformCount} AcroForm fields)` : ""
      }.`,
    });

    await emit({ type: "phase", phase: "suggest", msg: "Generating mock answers…" });
    const sug = await suggestAnswers(ins);

    await emit({ type: "phase", phase: "assemble", msg: "Assembling overlay…" });
    const { spec, preview } = assemble(ins, sug, a.pdfPath, a.outPath);

    await emit({ type: "phase", phase: "stamp", msg: "Stamping answers onto PDF…" });
    await stamp(spec, a.fillsPath);

    const done: RunEvent = {
      type: "done",
      jobId: a.jobId,
      fields_filled: spec.items.filter((i) => i.kind === "text").length,
      boxes_ticked: spec.items.filter((i) => i.kind === "check").length,
      preview,
    };
    await emit(done);
    return done;
  } catch (e) {
    await emit({
      type: "error",
      message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
