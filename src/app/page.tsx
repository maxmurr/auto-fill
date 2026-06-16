"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
  UploadIcon,
  FileTextIcon,
  DownloadIcon,
  CircleCheckIcon,
  Loader2Icon,
  XIcon,
  SparklesIcon,
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
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Request failed (${res.status})`);
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
    } catch (e) {
      setStatus("error");
      setActive(null);
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  function handleEvent(ev: {
    type: string;
    phase?: Phase;
    msg?: string;
    message?: string;
  } & Partial<Result>) {
    if (ev.type === "phase" && ev.phase) {
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
      toast.success("PDF filled — ready to download");
    } else if (ev.type === "error") {
      setStatus("error");
      setActive(null);
      toast.error(ev.message || "Workflow failed");
    }
  }

  const busy = status === "running";

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <SparklesIcon className="size-6 text-primary" />
          auto-fill
        </h1>
        <p className="text-sm text-muted-foreground">
          Upload a blank PDF form. The workflow inspects its layout, generates{" "}
          <span className="font-medium">mock sample answers</span>, and stamps
          them onto the original for you to download.
        </p>
      </header>

      {/* Dropzone */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pickFile(e.dataTransfer.files?.[0] ?? null);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors",
          dragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/40",
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
          <>
            <FileTextIcon className="size-8 text-primary" />
            <div className="flex items-center gap-2 text-sm font-medium">
              {file.name}
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
                className="text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-4" />
              </button>
            </div>
            <span className="text-xs text-muted-foreground">
              {(file.size / 1024).toFixed(0)} KB · click to replace
            </span>
          </>
        ) : (
          <>
            <UploadIcon className="size-8 text-muted-foreground" />
            <span className="text-sm font-medium">
              Drop a PDF here or click to browse
            </span>
            <span className="text-xs text-muted-foreground">
              Blank forms / questionnaires work best
            </span>
          </>
        )}
      </div>

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

      {/* Phase stepper */}
      {(busy || status === "done") && (
        <div className="flex flex-col gap-3 rounded-xl border p-4">
          <ol className="flex items-center justify-between gap-2">
            {PHASES.map((p, i) => {
              const state =
                status === "done" || i < phaseIndex
                  ? "done"
                  : i === phaseIndex
                    ? "active"
                    : "todo";
              return (
                <li
                  key={p.key}
                  className="flex flex-1 flex-col items-center gap-1.5"
                >
                  <span
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full border text-xs",
                      state === "done" &&
                        "border-primary bg-primary text-primary-foreground",
                      state === "active" &&
                        "border-primary text-primary",
                      state === "todo" &&
                        "border-border text-muted-foreground",
                    )}
                  >
                    {state === "done" ? (
                      <CircleCheckIcon className="size-4" />
                    ) : state === "active" ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span
                    className={cn(
                      "text-[11px]",
                      state === "todo"
                        ? "text-muted-foreground"
                        : "font-medium",
                    )}
                  >
                    {p.label}
                  </span>
                </li>
              );
            })}
          </ol>
          {busy && phaseMsg && (
            <p className="text-center text-xs text-muted-foreground">
              {phaseMsg}
            </p>
          )}
        </div>
      )}

      {/* Result */}
      {status === "done" && result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CircleCheckIcon className="size-5 text-primary" />
              Done
            </CardTitle>
            <CardDescription className="flex flex-wrap gap-2 pt-1">
              <Badge variant="secondary">
                {result.fields_filled} fields filled
              </Badge>
              <Badge variant="secondary">
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
                        <TableCell className="font-medium">{r.value}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Sample data only — values are AI-generated mock answers, not real
              information.
            </p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
