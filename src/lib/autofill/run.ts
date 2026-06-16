import path from "node:path";
import { inspect } from "./inspect";
import { suggestAnswers } from "./suggest";
import { assemble } from "./assemble";
import { stamp } from "./stamp";

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
 * Inspect → Suggest → Assemble → Stamp. Yields one event per phase so the API
 * route can stream progress; errors surface as a terminal `error` event.
 * `pdfPath` lives in the per-job working dir; all artefacts are written beside it.
 */
export async function* runWorkflow(
  jobId: string,
  pdfPath: string,
  stem: string,
): AsyncGenerator<RunEvent> {
  try {
    const dir = path.dirname(pdfPath);
    const anchorsPath = path.join(dir, "anchors.json");
    const fillsPath = path.join(dir, "fills.json");
    const outPath = path.join(dir, `${stem}_Filled.pdf`);

    yield { type: "phase", phase: "inspect", msg: "Inspecting form layout…" };
    const ins = await inspect(pdfPath, anchorsPath, stem);
    yield {
      type: "phase",
      phase: "inspect",
      msg: `Found ${ins.fields.length} fields, ${ins.checkboxes.length} checkboxes${
        ins.acroformCount ? ` (${ins.acroformCount} AcroForm fields)` : ""
      }.`,
    };

    yield { type: "phase", phase: "suggest", msg: "Generating mock answers…" };
    const sug = await suggestAnswers(ins);

    yield { type: "phase", phase: "assemble", msg: "Assembling overlay…" };
    const { spec, preview } = assemble(ins, sug, pdfPath, outPath);

    yield { type: "phase", phase: "stamp", msg: "Stamping answers onto PDF…" };
    await stamp(spec, fillsPath);

    yield {
      type: "done",
      jobId,
      fields_filled: spec.items.filter((i) => i.kind === "text").length,
      boxes_ticked: spec.items.filter((i) => i.kind === "check").length,
      preview,
    };
  } catch (e) {
    yield { type: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
