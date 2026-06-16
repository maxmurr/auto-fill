"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Light/dark toggle. Renders a neutral placeholder until mounted so the
 * server/client markup matches (theme is unknown during SSR), then flips
 * between the sun and moon based on the resolved theme.
 */
export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  // One-time mount flag so SSR markup matches the client before the resolved
  // theme is known — the canonical accepted setState-in-effect.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-11"
      aria-label={
        mounted
          ? `Switch to ${isDark ? "light" : "dark"} mode`
          : "Toggle theme"
      }
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {/* Both icons stacked; the active one rotates/scales in. Guarded so
          reduced-motion users get an instant swap instead of a spin. */}
      <SunIcon className="size-5 scale-100 rotate-0 transition-transform duration-300 motion-reduce:transition-none dark:scale-0 dark:-rotate-90" />
      <MoonIcon className="absolute size-5 scale-0 rotate-90 transition-transform duration-300 motion-reduce:transition-none dark:scale-100 dark:rotate-0" />
    </Button>
  );
}
