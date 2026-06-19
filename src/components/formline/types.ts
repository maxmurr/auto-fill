import type { PreviewRow } from "@/lib/autofill/assemble";

/** Workflow phases, in order — used to map a phase event to a 0–100 progress %. */
export type Phase = "inspect" | "suggest" | "assemble" | "stamp" | "verify";
export const PHASES: Phase[] = [
  "inspect",
  "suggest",
  "assemble",
  "stamp",
  "verify",
];

export type JobStatus = "processing" | "ready" | "completed" | "error";

/**
 * One reviewable answer derived from a filled job's preview rows. Editable rows
 * (`kind:"text"` with an id) can be edited → re-stamped; everything else is
 * read-only. `confirmed` is a client-side review gesture only.
 */
export type Answer = PreviewRow & {
  /** Stable list key — the row id when present, else an index fallback. */
  key: string;
  editable: boolean;
  confirmed: boolean;
};

/**
 * A single fill, tracked entirely client-side (the backend is one-shot and keeps
 * no job list). `jobId`/`runId` point at the server job for streaming, download,
 * preview and re-stamp; `version` cache-busts those URLs after a re-stamp.
 */
export type Job = {
  id: string;
  runId: string;
  jobId: string;
  fileName: string;
  createdAt: number;
  status: JobStatus;
  phase: Phase | null;
  progress: number;
  fieldsFilled: number;
  boxesTicked: number;
  pages: number;
  answers: Answer[];
  error: string | null;
  version: number;
};

/** Build review answers from preview rows, preserving prior confirm state by key. */
export function toAnswers(preview: PreviewRow[], prev?: Answer[]): Answer[] {
  const wasConfirmed = new Map((prev ?? []).map((a) => [a.key, a.confirmed]));
  return preview.map((r, i) => {
    const key = r.id ?? `row-${i}`;
    return {
      ...r,
      key,
      editable: r.kind === "text" && !!r.id,
      confirmed: wasConfirmed.get(key) ?? false,
    };
  });
}
