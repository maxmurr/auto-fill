import { useRef, useState } from "react";
import {
  UploadIcon,
  FileTextIcon,
  XIcon,
  ArrowRightIcon,
  Loader2Icon,
  SparklesIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Upload({
  selectedFile,
  onPick,
  onClear,
  onLoadSample,
  onAnalyze,
  starting,
}: {
  selectedFile: File | null;
  onPick: (file: File | null) => void;
  onClear: () => void;
  onLoadSample: () => void;
  onAnalyze: () => void;
  starting: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="mx-auto w-full max-w-xl duration-300 animate-in fade-in slide-in-from-bottom-2">
      <div className="mb-3 font-mono text-xs font-medium uppercase tracking-[0.08em] text-primary">
        Upload
      </div>
      <h1 className="mb-2 text-3xl font-bold tracking-tight">
        Upload a form to fill
      </h1>
      <p className="mb-7 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
        Drop a PDF form. auto-fill reads its layout, writes realistic mock
        answers, ticks the right boxes, and stamps them onto the original.
      </p>

      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a PDF form"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onPick(e.dataTransfer.files?.[0] ?? null);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-12 text-center outline-none transition-colors duration-150 focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40",
          dragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-accent/40",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          aria-label="Upload PDF form"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        />
        <span className="flex size-13 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <UploadIcon className="size-6" />
        </span>
        <span className="text-sm font-semibold">
          Drag &amp; drop your form, or{" "}
          <span className="text-primary">browse files</span>
        </span>
        <span className="text-xs text-muted-foreground">PDF forms only</span>
      </div>

      <div className="mt-5">
        <div className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
          Or try a sample
        </div>
        <button
          type="button"
          onClick={onLoadSample}
          className="flex w-full cursor-pointer items-center gap-3 rounded-xl border bg-card p-3.5 text-left outline-none transition-colors hover:border-primary/50 focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <SparklesIcon className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">Sample PDF form</span>
            <span className="block text-xs text-muted-foreground">
              A blank questionnaire ready to fill
            </span>
          </span>
        </button>
      </div>

      {selectedFile && (
        <div className="mt-5 flex items-center gap-4 rounded-2xl border bg-card p-4 duration-200 animate-in fade-in slide-in-from-bottom-1">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FileTextIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">
              {selectedFile.name}
            </div>
            <div className="mt-0.5 font-mono text-xs text-muted-foreground">
              {(selectedFile.size / 1024).toFixed(0)} KB · PDF
            </div>
          </div>
          {!starting && (
            <button
              type="button"
              aria-label="Remove file"
              onClick={onClear}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          )}
          <Button
            size="lg"
            disabled={starting}
            onClick={onAnalyze}
            className="shrink-0"
          >
            {starting ? (
              <>
                <Loader2Icon className="size-4 animate-spin" /> Starting…
              </>
            ) : (
              <>
                Analyze form <ArrowRightIcon className="size-4" />
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
