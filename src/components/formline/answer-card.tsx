import { useState } from "react";
import {
  PencilIcon,
  CheckIcon,
  Loader2Icon,
  CircleCheckIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Answer } from "./types";

export function AnswerCard({
  answer,
  index,
  busy,
  onSave,
  onConfirm,
}: {
  answer: Answer;
  index: number;
  /** True while this card's re-stamp is in flight. */
  busy: boolean;
  onSave: (id: string, value: string) => void;
  onConfirm: (key: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(answer.value);

  const startEdit = () => {
    setText(answer.value);
    setEditing(true);
  };
  const save = () => {
    setEditing(false);
    if (text.trim() && text !== answer.value && answer.id) {
      onSave(answer.id, text);
    }
  };

  return (
    <div
      className={cn(
        "flex overflow-hidden rounded-2xl border bg-card",
        answer.confirmed && "border-emerald-500/30",
      )}
    >
      <div
        className={cn(
          "w-1 shrink-0",
          answer.confirmed ? "bg-emerald-500" : "bg-border",
        )}
      />
      <div className="min-w-0 flex-1 p-4">
        <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
          <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="text-sm font-semibold">{answer.label}</span>
          <span className="flex-1" />
          {answer.confirmed && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <CircleCheckIcon className="size-3" /> Confirmed
            </span>
          )}
        </div>

        {editing ? (
          <>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              autoFocus
              className="text-base"
            />
            <div className="mt-2.5 flex items-center gap-2">
              <Button size="sm" onClick={save}>
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            <div
              className={cn(
                "text-base font-medium leading-snug",
                busy && "opacity-40",
              )}
            >
              {answer.value || (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2">
              {busy && (
                <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
                  <Loader2Icon className="size-3.5 animate-spin" /> Re-stamping…
                </span>
              )}
              <span className="flex-1" />
              {answer.editable && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={startEdit}
                >
                  <PencilIcon className="size-3.5" /> Edit
                </Button>
              )}
              <Button
                size="sm"
                variant={answer.confirmed ? "ghost" : "secondary"}
                disabled={busy}
                onClick={() => onConfirm(answer.key)}
              >
                <CheckIcon className="size-3.5" />
                {answer.confirmed ? "Confirmed" : "Confirm"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
