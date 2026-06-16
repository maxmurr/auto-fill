"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Thin client wrapper so the server `layout.tsx` can mount next-themes without
 * itself becoming a client component. Props pass straight through.
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
