"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { isPdfUpload } from "@/lib/pdf";
import type { RunEvent } from "@/lib/autofill/workflow";
import type { PreviewRow } from "@/lib/autofill/assemble";
import { FormlineHeader, type HeaderAction } from "@/components/formline/header";
import { Home } from "@/components/formline/home";
import { Upload } from "@/components/formline/upload";
import { Review } from "@/components/formline/review";
import { PHASES, toAnswers, type Job, type Phase } from "@/components/formline/types";

type View = "home" | "upload" | "review";

/** localStorage key holding the client-side job dashboard (the backend keeps none). */
const STORE_KEY = "formline:jobs:v1";

/** Map a workflow phase to a coarse 0–100% (5 evenly-weighted phases). */
function phaseProgress(phase: Phase) {
  const idx = PHASES.indexOf(phase);
  return idx >= 0 ? Math.round(((idx + 1) / PHASES.length) * 100) : 8;
}

export default function Home_Page() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [view, setView] = useState<View>("home");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [starting, setStarting] = useState(false);
  const [restampingKey, setRestampingKey] = useState<string | null>(null);

  const updateJob = useCallback((id: string, fn: (j: Job) => Job) => {
    setJobs((js) => js.map((j) => (j.id === id ? fn(j) : j)));
  }, []);

  // Apply one streamed event to its job. `done` carries everything the review
  // view needs, so a replayed stream rebuilds a job from scratch.
  const applyEvent = useCallback(
    (id: string, ev: RunEvent) => {
      if (ev.type === "phase" && ev.phase) {
        const progress = phaseProgress(ev.phase);
        updateJob(id, (j) => ({
          ...j,
          status: "processing",
          phase: ev.phase,
          progress: Math.max(j.progress, progress),
        }));
      } else if (ev.type === "done") {
        updateJob(id, (j) => ({
          ...j,
          status: "ready",
          phase: null,
          progress: 100,
          fieldsFilled: ev.fields_filled ?? 0,
          boxesTicked: ev.boxes_ticked ?? 0,
          pages: ev.pages ?? 0,
          answers: toAnswers(ev.preview ?? []),
          error: null,
        }));
        toast.success("A form is ready to review");
      } else if (ev.type === "error") {
        updateJob(id, (j) => ({
          ...j,
          status: "error",
          phase: null,
          error: ev.message || "Workflow failed",
        }));
        toast.error(ev.message || "Workflow failed");
      }
    },
    [updateJob],
  );

  // Stream a run's NDJSON progress into its job. Used for fresh runs and for
  // replaying after a reload (startIndex=0 → full replay).
  const consume = useCallback(
    async (id: string, runId: string) => {
      try {
        const res = await fetch(
          `/api/autofill/stream?runId=${encodeURIComponent(runId)}&startIndex=0`,
        );
        if (!res.ok || !res.body) {
          updateJob(id, (j) => ({
            ...j,
            status: "error",
            phase: null,
            error: res.status === 404 ? "Run expired" : `Stream failed (${res.status})`,
          }));
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          buf += dec.decode(value ?? new Uint8Array(), { stream: !done });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) applyEvent(id, JSON.parse(line));
          }
          if (done) break;
        }
      } catch {
        // Only fail a still-running job — a transient error after `done` is moot.
        updateJob(id, (j) =>
          j.status === "processing"
            ? { ...j, status: "error", phase: null, error: "Connection lost" }
            : j,
        );
      }
    },
    [applyEvent, updateJob],
  );

  // Hydrate the dashboard from localStorage once, and reconnect any run that was
  // still processing. Server markup renders empty, so this runs post-mount to
  // avoid a hydration mismatch.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    let stored: Job[] = [];
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch {
      stored = [];
    }
    if (!stored.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJobs(stored);
    for (const j of stored) {
      if (j.status === "processing") void consume(j.id, j.runId);
    }
  }, [consume]);

  // Persist the dashboard. Skip the first run so the empty initial state doesn't
  // clobber what `hydrate` is about to read back.
  const firstPersist = useRef(true);
  useEffect(() => {
    if (firstPersist.current) {
      firstPersist.current = false;
      return;
    }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(jobs));
    } catch {
      /* quota / disabled storage — dashboard just won't survive a reload */
    }
  }, [jobs]);

  const pickFile = (f: File | null) => {
    if (!f) return;
    if (!isPdfUpload(f)) {
      toast.error("Please choose a PDF file");
      return;
    }
    setSelectedFile(f);
  };

  const loadSample = async () => {
    try {
      const res = await fetch("/sample-form.pdf");
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      setSelectedFile(
        new File([blob], "sample-form.pdf", { type: "application/pdf" }),
      );
    } catch {
      toast.error("Couldn't load the sample form");
    }
  };

  const startFill = async () => {
    if (!selectedFile) return;
    setStarting(true);
    try {
      const fd = new FormData();
      fd.append("file", selectedFile);
      const res = await fetch("/api/autofill", { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Request failed (${res.status})`);
      }
      const { runId, jobId } = (await res.json()) as {
        runId: string;
        jobId: string;
      };
      const id = crypto.randomUUID();
      const job: Job = {
        id,
        runId,
        jobId,
        fileName: selectedFile.name,
        createdAt: Date.now(),
        status: "processing",
        phase: "inspect",
        progress: 8,
        fieldsFilled: 0,
        boxesTicked: 0,
        pages: 0,
        answers: [],
        error: null,
        version: 0,
      };
      setJobs((js) => [job, ...js]);
      setSelectedFile(null);
      setView("home");
      void consume(id, runId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the fill");
    } finally {
      setStarting(false);
    }
  };

  const openJob = (id: string) => {
    setActiveJobId(id);
    setView("review");
  };
  const goHome = () => {
    setView("home");
    setActiveJobId(null);
  };
  const newForm = () => {
    setSelectedFile(null);
    setView("upload");
  };

  const activeJob = jobs.find((j) => j.id === activeJobId) ?? null;

  const confirmAnswer = (key: string) => {
    if (!activeJob) return;
    updateJob(activeJob.id, (j) => ({
      ...j,
      answers: j.answers.map((a) =>
        a.key === key ? { ...a, confirmed: true } : a,
      ),
    }));
  };
  const confirmAll = () => {
    if (!activeJob) return;
    updateJob(activeJob.id, (j) => ({
      ...j,
      answers: j.answers.map((a) => ({ ...a, confirmed: true })),
    }));
  };
  const markDownloaded = () => {
    if (!activeJob) return;
    updateJob(activeJob.id, (j) =>
      j.status === "ready" ? { ...j, status: "completed" } : j,
    );
  };

  // Edit → re-stamp: optimistically show the new value, then re-fill the PDF so
  // download + preview reflect it.
  const saveEdit = async (answerId: string, value: string) => {
    if (!activeJob) return;
    const job = activeJob;
    const key = job.answers.find((a) => a.id === answerId)?.key ?? answerId;
    setRestampingKey(key);
    updateJob(job.id, (j) => ({
      ...j,
      answers: j.answers.map((a) =>
        a.id === answerId ? { ...a, value } : a,
      ),
    }));
    try {
      const res = await fetch(`/api/autofill/${job.jobId}/restamp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ edits: { [answerId]: value } }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `Re-stamp failed (${res.status})`);
      }
      const result = (await res.json()) as {
        fields_filled: number;
        boxes_ticked: number;
        pages: number;
        preview: PreviewRow[];
      };
      updateJob(job.id, (j) => ({
        ...j,
        fieldsFilled: result.fields_filled,
        boxesTicked: result.boxes_ticked,
        pages: result.pages,
        version: j.version + 1,
        answers: toAnswers(result.preview, j.answers).map((a) =>
          a.key === key ? { ...a, confirmed: true } : a,
        ),
      }));
      toast.success("Updated — PDF re-stamped");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Re-stamp failed");
    } finally {
      setRestampingKey(null);
    }
  };

  const headerAction: HeaderAction =
    view === "upload"
      ? { label: "Cancel", onClick: goHome, variant: "outline" }
      : { label: "New form", onClick: newForm, icon: <PlusIcon className="size-4" /> };

  // A stale review link (active job removed) falls back to the dashboard.
  const showReview = view === "review" && activeJob;

  return (
    <>
      <FormlineHeader action={headerAction} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        {view === "home" && (
          <Home jobs={jobs} onNewForm={newForm} onOpen={openJob} />
        )}
        {view === "upload" && (
          <Upload
            selectedFile={selectedFile}
            onPick={pickFile}
            onClear={() => setSelectedFile(null)}
            onLoadSample={loadSample}
            onAnalyze={startFill}
            starting={starting}
          />
        )}
        {showReview && (
          <Review
            job={activeJob}
            onBack={goHome}
            onDownload={markDownloaded}
            onSave={saveEdit}
            onConfirm={confirmAnswer}
            onConfirmAll={confirmAll}
            restampingKey={restampingKey}
          />
        )}
        {view === "review" && !activeJob && (
          <Home jobs={jobs} onNewForm={newForm} onOpen={openJob} />
        )}
      </main>
    </>
  );
}
