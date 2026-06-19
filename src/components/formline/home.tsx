import { formatDistanceToNow } from "date-fns";
import {
  PlusIcon,
  FileTextIcon,
  Loader2Icon,
  CircleCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Job, JobStatus } from "./types";

const STATUS: Record<
  JobStatus,
  { label: string; pill: string }
> = {
  processing: {
    label: "Processing",
    pill: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  },
  ready: {
    label: "Ready to review",
    pill: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  },
  completed: {
    label: "Completed",
    pill: "bg-muted text-muted-foreground",
  },
  error: {
    label: "Failed",
    pill: "bg-destructive/10 text-destructive",
  },
};

function summaryLine(jobs: Job[]): string {
  const processing = jobs.filter((j) => j.status === "processing").length;
  const ready = jobs.filter((j) => j.status === "ready").length;
  const parts: string[] = [];
  if (processing) parts.push(`${processing} processing`);
  if (ready) parts.push(`${ready} ready to review`);
  if (parts.length) return parts.join(" · ");
  return `${jobs.length} ${jobs.length === 1 ? "form" : "forms"}`;
}

function jobSummary(j: Job): string {
  const confirmed = j.answers.filter((a) => a.confirmed).length;
  const total = j.answers.length;
  if (j.status === "processing") return "Filling in the background";
  if (j.status === "error") return j.error ?? "Something went wrong";
  if (j.status === "completed")
    return `Downloaded · ${confirmed}/${total} confirmed`;
  return `${confirmed} of ${total} confirmed`;
}

function JobCard({ job, onOpen }: { job: Job; onOpen: (id: string) => void }) {
  const meta = STATUS[job.status];
  const canOpen = job.status === "ready" || job.status === "completed";
  return (
    <div
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={canOpen ? () => onOpen(job.id) : undefined}
      onKeyDown={
        canOpen
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(job.id);
              }
            }
          : undefined
      }
      className={cn(
        "flex items-center gap-4 rounded-2xl border bg-card p-4 text-left transition-colors",
        canOpen && "cursor-pointer outline-none hover:border-primary/40 focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40",
      )}
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <FileTextIcon className="size-5" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{job.fileName}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {formatDistanceToNow(job.createdAt, { addSuffix: true })} ·{" "}
          {jobSummary(job)}
        </div>
        {job.status === "processing" && (
          <div className="mt-2.5 flex items-center gap-2.5">
            <div className="h-1.5 max-w-60 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                style={{ width: `${job.progress}%` }}
              />
            </div>
            <span className="font-mono text-[11px] tabular-nums text-primary">
              {job.progress}%
            </span>
          </div>
        )}
      </div>

      <span
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
          meta.pill,
        )}
      >
        {job.status === "processing" && (
          <Loader2Icon className="size-3 animate-spin" />
        )}
        {job.status === "ready" && <CircleCheckIcon className="size-3" />}
        {job.status === "error" && <TriangleAlertIcon className="size-3" />}
        {meta.label}
      </span>

      {canOpen && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(job.id);
          }}
        >
          {job.status === "completed" ? "Open" : "Review"}
        </Button>
      )}
    </div>
  );
}

export function Home({
  jobs,
  onNewForm,
  onOpen,
}: {
  jobs: Job[];
  onNewForm: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl duration-300 animate-in fade-in slide-in-from-bottom-2">
      <div className="mb-1 flex items-end justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Your forms</h1>
        {jobs.length > 0 && (
          <span className="text-sm font-medium text-muted-foreground">
            {summaryLine(jobs)}
          </span>
        )}
      </div>
      <p className="mb-6 max-w-xl text-pretty text-sm leading-relaxed text-muted-foreground">
        Fills run in the background — start a new one any time. We keep working
        while you do other things and flag each form when it&apos;s ready to
        review. Values are AI-generated mock data, not real information.
      </p>

      <button
        type="button"
        onClick={onNewForm}
        className="mb-5 flex w-full cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed border-border bg-card/40 p-4 text-left outline-none transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <PlusIcon className="size-5" />
        </span>
        <span>
          <span className="block text-sm font-semibold">Upload a new form</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Drop a PDF — filled in the background
          </span>
        </span>
      </button>

      {jobs.length === 0 ? (
        <div className="rounded-2xl border border-dashed py-14 text-center text-sm text-muted-foreground">
          No forms yet. Upload one to get started.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}
