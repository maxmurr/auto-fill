import fs from "node:fs/promises";
import { getWritable } from "workflow";
import { inspect } from "./inspect";
import { inspectAcroform } from "./acroform";
import { suggestAnswers, suggestAcroform } from "./suggest";
import { assemble, assembleAcroform, type PreviewRow } from "./assemble";
import { stamp } from "./stamp";
import { flattenPdf, renderPdf } from "./python";
import type { RunState } from "./schemas";

/**
 * One event per phase, streamed to the run's default writable. `done` carries
 * everything the UI needs (incl. jobId for the download link + rendered preview
 * page count), so a client that replays the stream from index 0 rebuilds the
 * full result without extra state.
 */
export type RunEvent =
  | {
      type: "phase";
      phase: "inspect" | "suggest" | "assemble" | "stamp" | "verify";
      msg: string;
    }
  | {
      type: "done";
      jobId: string;
      fields_filled: number;
      boxes_ticked: number;
      pages: number;
      preview: PreviewRow[];
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
  acroPath: string;
  flatPath: string;
  fillsPath: string;
  statePath: string;
  outPath: string;
  dir: string;
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

/** Flatten widget annotations so overlay marks aren't occluded (AcroForm path). */
async function flattenStep(src: string, out: string): Promise<void> {
  "use step";
  await flattenPdf(src, out);
}

/** Persist the inputs the re-stamp route replays (branch + normalised inspect/suggest). */
async function persistState(statePath: string, state: RunState): Promise<void> {
  "use step";
  await fs.writeFile(statePath, JSON.stringify(state), "utf8");
}

/** Render the filled PDF to preview PNGs in the job dir; return the page count. */
async function renderPreviews(pdf: string, dir: string): Promise<number> {
  "use step";
  const pngs = await renderPdf(pdf, dir, "verify", 150);
  return pngs.length;
}

/**
 * Durable fill pipeline: Inspect → Suggest → Assemble → Stamp → Verify. An
 * AcroForm (interactive-fields) PDF takes the flatten-then-overlay branch
 * (Thai-safe, no widget occlusion); everything else takes the geometric overlay
 * branch (blanks, checkboxes, rect-grid tables). Each phase emits a progress
 * event; errors emit a terminal `error` event then rethrow so the run fails.
 */
export async function fillWorkflow(a: FillArgs): Promise<RunEvent> {
  "use workflow";
  try {
    await emit({ type: "phase", phase: "inspect", msg: "Inspecting form layout…" });
    const ins = await inspect(a.pdfPath, a.anchorsPath, a.stem);
    await emit({
      type: "phase",
      phase: "inspect",
      msg: `Found ${ins.fields.length} fields, ${ins.checkboxes.length} checkboxes, ${ins.tables.length} tables${
        ins.acroformCount ? ` (${ins.acroformCount} AcroForm fields)` : ""
      }.`,
    });

    let assembled:
      | ReturnType<typeof assemble>
      | ReturnType<typeof assembleAcroform>
      | null = null;
    // Captured alongside `assembled` so the re-stamp route can replay the exact
    // assemble inputs with edited text values.
    let state: RunState | null = null;

    // AcroForm branch — only when interactive fields are actually present and
    // we can read their geometry; otherwise fall through to the overlay branch.
    if (ins.acroformCount > 0) {
      const acro = await inspectAcroform(a.pdfPath, a.acroPath);
      if (acro.texts.length + acro.buttons.length > 0) {
        await emit({
          type: "phase",
          phase: "suggest",
          msg: `Generating answers for ${acro.texts.length} fields + ${acro.buttons.length} option groups…`,
        });
        const sug = await suggestAcroform(acro);

        await emit({ type: "phase", phase: "assemble", msg: "Flattening widgets + assembling overlay…" });
        await flattenStep(a.pdfPath, a.flatPath);
        assembled = assembleAcroform(acro, sug, a.flatPath, a.outPath);
        state = { branch: "acroform", acro, sug };
      }
    }

    if (!assembled) {
      await emit({ type: "phase", phase: "suggest", msg: "Generating mock answers…" });
      const sug = await suggestAnswers(ins);
      await emit({ type: "phase", phase: "assemble", msg: "Assembling overlay…" });
      assembled = assemble(ins, sug, a.pdfPath, a.outPath);
      state = { branch: "overlay", ins, sug };
    }

    if (state) await persistState(a.statePath, state);

    await emit({ type: "phase", phase: "stamp", msg: "Stamping answers onto PDF…" });
    await stamp(assembled.spec, a.fillsPath);

    await emit({ type: "phase", phase: "verify", msg: "Rendering filled pages to verify…" });
    const pages = await renderPreviews(a.outPath, a.dir);

    const done: RunEvent = {
      type: "done",
      jobId: a.jobId,
      fields_filled: assembled.fieldsFilled,
      boxes_ticked: assembled.boxesTicked,
      pages,
      preview: assembled.preview,
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
