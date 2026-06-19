import fs from "node:fs/promises";
import path from "node:path";
import { assemble, assembleAcroform, type Assembled } from "./assemble";
import { runPy, renderPdf, jobDirPath } from "./python";
import type { RunState } from "./schemas";

/**
 * Apply text-value overrides to a persisted run state, keyed by the same id the
 * review UI received in each preview row (overlay → field id; AcroForm → field
 * name). Only text values are editable; checks/ticks are left untouched.
 */
function applyEdits(state: RunState, edits: Record<string, string>): RunState {
  if (state.branch === "overlay") {
    return {
      ...state,
      sug: {
        ...state.sug,
        values: state.sug.values.map((v) =>
          v.id in edits ? { ...v, value: edits[v.id] } : v,
        ),
      },
    };
  }
  return {
    ...state,
    sug: {
      ...state.sug,
      texts: state.sug.texts.map((t) =>
        t.name in edits ? { ...t, value: edits[t.name] } : t,
      ),
    },
  };
}

export type RestampResult = {
  fields_filled: number;
  boxes_ticked: number;
  pages: number;
  preview: Assembled["preview"];
};

/**
 * Re-run assemble→overlay→render for an existing job with edited text values so
 * the downloaded PDF and preview PNGs reflect the edits. Replays the original
 * inspect/suggest captured in `state.json`, overwriting the filled PDF in place.
 * Calls the python helpers directly (not the durable `stamp` step) so it can run
 * in a normal request handler outside a workflow run. Edits stack: the patched
 * state is written back so a later edit builds on this one.
 */
export async function restamp(
  jobId: string,
  edits: Record<string, string>,
): Promise<RestampResult> {
  const dir = jobDirPath(jobId);
  const statePath = path.join(dir, "state.json");
  const state: RunState = JSON.parse(await fs.readFile(statePath, "utf8"));
  const meta: { downloadName: string } = JSON.parse(
    await fs.readFile(path.join(dir, "meta.json"), "utf8"),
  );

  const next = applyEdits(state, edits);
  // basename() keeps the write inside `dir` regardless of how meta was stored.
  const outPath = path.join(dir, path.basename(meta.downloadName));
  const fillsPath = path.join(dir, "fills.json");

  const assembled: Assembled =
    next.branch === "overlay"
      ? assemble(next.ins, next.sug, path.join(dir, "in.pdf"), outPath)
      : assembleAcroform(next.acro, next.sug, path.join(dir, "flat.pdf"), outPath);

  await fs.writeFile(fillsPath, JSON.stringify(assembled.spec, null, 2), "utf8");
  await runPy("overlay_fill.py", [fillsPath]);
  const pages = (await renderPdf(outPath, dir, "verify", 150)).length;

  await fs.writeFile(statePath, JSON.stringify(next), "utf8");

  return {
    fields_filled: assembled.fieldsFilled,
    boxes_ticked: assembled.boxesTicked,
    pages,
    preview: assembled.preview,
  };
}
