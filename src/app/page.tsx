"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  UploadIcon,
  FileTextIcon,
  DownloadIcon,
  CircleCheckIcon,
  Loader2Icon,
  XIcon,
  SparklesIcon,
  ScanLineIcon,
  RotateCcwIcon,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

type Phase = "inspect" | "suggest" | "assemble" | "stamp";
const PHASES: { key: Phase; label: string }[] = [
  { key: "inspect", label: "Inspect" },
  { key: "suggest", label: "Suggest" },
  { key: "assemble", label: "Assemble" },
  { key: "stamp", label: "Stamp" },
];

type Result = {
  jobId: string;
  fields_filled: number;
  boxes_ticked: number;
  preview: { label: string; value: string }[];
};

type Status = "idle" | "running" | "done" | "error";

/** localStorage key holding the in-flight run so a refresh/reconnect can replay it. */
const STORE_KEY = "autofill:last";
const clearStored = () => {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [active, setActive] = useState<Phase | null>(null);
  const [phaseMsg, setPhaseMsg] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const phaseIndex = active ? PHASES.findIndex((p) => p.key === active) : -1;

  const pickFile = useCallback((f: File | null) => {
    if (!f) return;
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Please choose a PDF file");
      return;
    }
    setFile(f);
    setStatus("idle");
    setResult(null);
    setActive(null);
  }, []);

  // Reset the whole flow back to an empty dropzone ("Fill another").
  const reset = useCallback(() => {
    setFile(null);
    setStatus("idle");
    setResult(null);
    setActive(null);
    setPhaseMsg("");
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  // Apply one NDJSON event to the UI. `done` carries everything (incl. jobId),
  // so a replayed stream rebuilds the result + download link from scratch.
  const handleEvent = useCallback(
    (
      ev: {
        type: string;
        phase?: Phase;
        msg?: string;
        message?: string;
      } & Partial<Result>,
    ) => {
      if (ev.type === "phase" && ev.phase) {
        setStatus("running");
        setActive(ev.phase);
        if (ev.msg) setPhaseMsg(ev.msg);
      } else if (ev.type === "done") {
        setActive(null);
        setStatus("done");
        setResult({
          jobId: ev.jobId!,
          fields_filled: ev.fields_filled ?? 0,
          boxes_ticked: ev.boxes_ticked ?? 0,
          preview: ev.preview ?? [],
        });
        clearStored();
        toast.success("PDF filled — ready to download");
      } else if (ev.type === "error") {
        setStatus("error");
        setActive(null);
        clearStored();
        toast.error(ev.message || "Workflow failed");
      }
    },
    [],
  );

  // Stream a run's NDJSON progress (from `startIndex`) into the UI. Used both
  // for a fresh run and for replaying after a reconnect.
  const consume = useCallback(async (runId: string, startIndex: number) => {
    const res = await fetch(
      `/api/autofill/stream?runId=${encodeURIComponent(runId)}&startIndex=${startIndex}`,
    );
    if (!res.ok || !res.body) {
      if (res.status === 404) clearStored();
      throw new Error(`Stream failed (${res.status})`);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let done = false;
    while (!done) {
      const { done: d, value } = await reader.read();
      done = d;
      buf += dec.decode(value ?? new Uint8Array(), { stream: !d });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) handleEvent(JSON.parse(line));
      }
    }
  }, [handleEvent]);

  // Replay an existing run from the start (setState lives here, not in the
  // effect body, to avoid synchronous setState-in-effect).
  const reconnect = useCallback(
    async (runId: string) => {
      try {
        await consume(runId, 0);
      } catch {
        clearStored();
        setStatus("idle");
        setActive(null);
      }
    },
    [consume],
  );

  // On mount, resume an in-flight run left in localStorage (e.g. after a refresh).
  useEffect(() => {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    let stored: { runId: string; jobId: string };
    try {
      stored = JSON.parse(raw);
    } catch {
      clearStored();
      return;
    }
    // Subscribe to the existing run: setState happens in handleEvent as stream
    // events arrive (after await), not synchronously here — the lint can't see
    // through the async stream boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reconnect(stored.runId);
  }, [reconnect]);

  async function run() {
    if (!file) return;
    setStatus("running");
    setResult(null);
    setActive("inspect");
    setPhaseMsg("Starting…");

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/autofill", { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Request failed (${res.status})`);
      }
      const { runId, jobId } = (await res.json()) as {
        runId: string;
        jobId: string;
      };
      localStorage.setItem(STORE_KEY, JSON.stringify({ runId, jobId }));
      await consume(runId, 0);
    } catch (e) {
      setStatus("error");
      setActive(null);
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  const busy = status === "running";
  const showProgress = busy || status === "done";
  // Per-step display state, derived once and reused by both the circle row and
  // the label row below it.
  const steps = PHASES.map((p, i) => ({
    ...p,
    state:
      status === "done" || i < phaseIndex
        ? ("done" as const)
        : i === phaseIndex
          ? ("active" as const)
          : ("todo" as const),
  }));

  return (
    <>
      {/* Top bar */}
      <header className="border-b border-border/60">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 py-3">
          <span className="flex items-center gap-2 font-mono text-sm font-medium tracking-tight">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ScanLineIcon className="size-4" />
            </span>
            auto-fill
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 pb-20">
        {/* Hero */}
        <section className="flex flex-col gap-4 pt-12 sm:pt-16">
          <h1 className="text-balance text-[clamp(2.25rem,6vw,4rem)] leading-[1.04] font-bold tracking-[-0.03em]">
            Fill any PDF form
            <br />
            in seconds.
          </h1>
          <p className="max-w-prose text-pretty text-base leading-relaxed text-muted-foreground">
            Drop in a blank form — auto-fill reads its layout, writes realistic
            sample answers, ticks the right boxes, and stamps them onto the
            original to download. Values are{" "}
            <span className="font-medium text-foreground">
              AI-generated mock data
            </span>
            , not real information.
          </p>
        </section>

        {/* Dropzone */}
        <div
          role="button"
          tabIndex={busy ? -1 : 0}
          aria-label={file ? "Replace selected PDF" : "Upload a PDF form"}
          onClick={() => !busy && inputRef.current?.click()}
          onKeyDown={(e) => {
            if (busy) return;
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!busy) pickFile(e.dataTransfer.files?.[0] ?? null);
          }}
          className={cn(
            "group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center outline-none transition-colors duration-150 ease-out",
            "focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/40",
            busy && "pointer-events-none opacity-60",
            dragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-accent/40",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <div className="flex flex-col items-center gap-3 duration-200 animate-in fade-in zoom-in-95">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <FileTextIcon className="size-7" />
              </span>
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="max-w-[16rem] truncate">{file.name}</span>
                <button
                  type="button"
                  aria-label="Remove file"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    setStatus("idle");
                    setResult(null);
                    if (inputRef.current) inputRef.current.value = "";
                  }}
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <XIcon className="size-4" />
                </button>
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">
                {(file.size / 1024).toFixed(0)} KB · click to replace
              </span>
            </div>
          ) : (
            <>
              <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground transition-transform duration-150 ease-out group-hover:scale-105 motion-reduce:transform-none">
                <UploadIcon className="size-7" />
              </span>
              <span className="text-base font-medium">
                Drop a PDF here, or click to browse
              </span>
              <span className="text-xs text-muted-foreground">
                Blank forms &amp; questionnaires work best
              </span>
            </>
          )}
        </div>

        {/* Primary action — hidden once a result is showing (the result card owns the next action). */}
        {status !== "done" && (
          <Button
            size="lg"
            disabled={!file || busy}
            onClick={run}
            className="w-full"
          >
            {busy ? (
              <>
                <Loader2Icon className="size-4 animate-spin" /> Running workflow…
              </>
            ) : (
              <>
                <SparklesIcon className="size-4" /> Fill PDF
              </>
            )}
          </Button>
        )}

        {/* Progress — the workflow's signature waiting moment. */}
        {showProgress && (
          <div
            className={cn(
              "relative overflow-hidden rounded-2xl border bg-card p-6 shadow-sm transition-colors duration-300",
              busy && "border-primary/30",
            )}
          >
            {/* Scanner overlay while running: a blueprint grid that fills the
                whole box, plus a full-height beam wash with a glowing leading
                edge sweeping top→bottom. Decorative, reduced-motion safe. */}
            {busy && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden"
              >
                <div className="scan-grid absolute inset-0 opacity-[0.1]" />
                <div className="animate-scan absolute inset-x-0 top-0 h-full bg-linear-to-b from-primary/0 via-primary/10 to-primary/25">
                  <div className="absolute inset-x-0 bottom-0 h-0.5 bg-primary/80 shadow-[0_0_16px_3px_var(--color-primary)]" />
                </div>
              </div>
            )}

            <div className="relative flex flex-col gap-5">
              {/* Stepper: circles joined by per-gap connectors that fill as each
                  phase lands. Connectors live strictly between circles (a flex
                  child in the gap), so the line never tunnels through a circle. */}
              <div className="flex flex-col gap-2">
                <ol className="flex items-center">
                  {steps.map((s, i) => (
                    <Fragment key={s.key}>
                      {i > 0 && (
                        <li
                          aria-hidden
                          className="h-0.5 flex-1 overflow-hidden rounded-full bg-border"
                        >
                          <span
                            className={cn(
                              "block h-full origin-left bg-primary transition-transform duration-500 ease-[cubic-bezier(0.645,0.045,0.355,1)] motion-reduce:transition-none",
                              i <= phaseIndex || status === "done"
                                ? "scale-x-100"
                                : "scale-x-0",
                            )}
                          />
                        </li>
                      )}
                      <li
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums transition-colors duration-300",
                          s.state === "done" &&
                            "border-primary bg-primary text-primary-foreground",
                          s.state === "active" && "border-primary text-primary",
                          s.state === "todo" &&
                            "border-border bg-card text-muted-foreground",
                        )}
                      >
                        {s.state === "done" ? (
                          <CircleCheckIcon className="size-4 duration-300 animate-in zoom-in-50" />
                        ) : s.state === "active" ? (
                          <Loader2Icon className="size-4 animate-spin" />
                        ) : (
                          i + 1
                        )}
                      </li>
                    </Fragment>
                  ))}
                </ol>

                {/* Labels mirror the row's flex structure so each sits centered
                    under its circle (w-8 cells over circles, flex-1 over gaps). */}
                <ol className="flex items-start" aria-hidden>
                  {steps.map((s, i) => (
                    <Fragment key={s.key}>
                      {i > 0 && <span className="flex-1" />}
                      <span className="flex w-8 shrink-0 justify-center">
                        <span
                          className={cn(
                            "text-[11px] whitespace-nowrap",
                            s.state === "todo"
                              ? "text-muted-foreground"
                              : "font-medium text-foreground",
                          )}
                        >
                          {s.label}
                        </span>
                      </span>
                    </Fragment>
                  ))}
                </ol>
              </div>

              {/* Live phase narration — announced to screen readers. */}
              <p
                aria-live="polite"
                className="min-h-5 text-center text-xs text-muted-foreground"
              >
                {busy && phaseMsg && (
                  <span
                    key={phaseMsg}
                    className="inline-block duration-300 animate-in fade-in"
                  >
                    {phaseMsg}
                  </span>
                )}
              </p>
            </div>
          </div>
        )}

        {/* Result */}
        {status === "done" && result && (
          <Card className="duration-300 animate-in fade-in slide-in-from-bottom-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CircleCheckIcon className="size-5 text-primary" />
                Done
              </CardTitle>
              <CardDescription className="flex flex-wrap gap-2 pt-1">
                <Badge
                  variant="secondary"
                  className="tabular-nums duration-300 animate-in fade-in"
                  style={{ animationDelay: "80ms", animationFillMode: "both" }}
                >
                  {result.fields_filled} fields filled
                </Badge>
                <Badge
                  variant="secondary"
                  className="tabular-nums duration-300 animate-in fade-in"
                  style={{ animationDelay: "160ms", animationFillMode: "both" }}
                >
                  {result.boxes_ticked} boxes ticked
                </Badge>
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <a
                href={`/api/autofill/${result.jobId}/download`}
                download
                className={cn(buttonVariants({ size: "lg" }))}
              >
                <DownloadIcon className="size-4" /> Download filled PDF
              </a>

              {result.preview.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    What was filled in
                  </p>
                  <div className="max-h-72 overflow-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Field</TableHead>
                          <TableHead>Mock value</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.preview.map((r, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-muted-foreground">
                              {r.label}
                            </TableCell>
                            <TableCell className="font-medium">
                              {r.value}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Sample data only — AI-generated mock answers, not real
                  information.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={reset}
                  className="shrink-0"
                >
                  <RotateCcwIcon className="size-4" /> Fill another
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}
