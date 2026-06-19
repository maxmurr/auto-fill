import { ScanLineIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

export type HeaderAction = {
  label: string;
  onClick: () => void;
  variant?: "default" | "outline";
  icon?: React.ReactNode;
};

/** Sticky top bar: brand + an optional context action (e.g. New form / Cancel) + theme toggle. */
export function FormlineHeader({ action }: { action?: HeaderAction }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <span className="flex items-center gap-2 font-mono text-sm font-semibold tracking-tight">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ScanLineIcon className="size-4" />
          </span>
          auto-fill
        </span>
        <div className="flex items-center gap-1.5">
          {action && (
            <Button
              variant={action.variant ?? "default"}
              size="sm"
              onClick={action.onClick}
            >
              {action.icon}
              {action.label}
            </Button>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
