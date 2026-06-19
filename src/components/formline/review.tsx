import { ArrowLeftIcon, DownloadIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { AnswerCard } from "./answer-card";
import type { Job } from "./types";

export function Review({
  job,
  onBack,
  onDownload,
  onSave,
  onConfirm,
  onConfirmAll,
  restampingKey,
}: {
  job: Job;
  onBack: () => void;
  onDownload: () => void;
  onSave: (id: string, value: string) => void;
  onConfirm: (key: string) => void;
  onConfirmAll: () => void;
  restampingKey: string | null;
}) {
  const confirmed = job.answers.filter((a) => a.confirmed).length;
  const needLook = job.answers.length - confirmed;

  return (
    <div className="mx-auto w-full max-w-3xl duration-300 animate-in fade-in slide-in-from-bottom-2">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" /> All forms
      </button>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="mb-2 text-3xl font-bold tracking-tight">
            Review the filled form
          </h1>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-emerald-500" />
              {confirmed} confirmed
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-amber-500" />
              {needLook} need a look
            </span>
          </div>
        </div>
        <a
          href={`/api/autofill/${job.jobId}/download?v=${job.version}`}
          download
          onClick={onDownload}
          className={cn(buttonVariants({ size: "lg" }))}
        >
          <DownloadIcon className="size-4" /> Download filled PDF
        </a>
      </div>

      <Tabs defaultValue="answers">
        <TabsList>
          <TabsTrigger value="answers">
            Answers · {job.answers.length}
          </TabsTrigger>
          <TabsTrigger value="document">Document preview</TabsTrigger>
        </TabsList>

        <TabsContent value="answers" className="pt-2">
          {job.answers.length === 0 ? (
            <div className="rounded-2xl border border-dashed py-12 text-center text-sm text-muted-foreground">
              No fillable fields were detected in this form.
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                {job.answers.map((a, i) => (
                  <AnswerCard
                    key={a.key}
                    answer={a}
                    index={i}
                    busy={restampingKey === a.key}
                    onSave={onSave}
                    onConfirm={onConfirm}
                  />
                ))}
              </div>
              <div className="mt-4 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onConfirmAll}
                  disabled={needLook === 0}
                >
                  Confirm all answers
                </Button>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="document" className="pt-2">
          <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary" />
            Rendered from the filled PDF — reflects your latest edits.
          </div>
          {job.pages > 0 ? (
            <div className="flex flex-col items-center gap-4 rounded-2xl border bg-muted/40 p-4 sm:p-6">
              {Array.from({ length: job.pages }, (_, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={`/api/autofill/${job.jobId}/preview/${i + 1}?v=${job.version}`}
                  alt={`Filled page ${i + 1}`}
                  loading="lazy"
                  className="w-full max-w-2xl rounded-lg border bg-white shadow-sm"
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed py-12 text-center text-sm text-muted-foreground">
              No preview available.
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
