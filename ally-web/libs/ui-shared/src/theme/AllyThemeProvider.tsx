"use client";

import type { ReactNode } from "react";

import { GlobalTheme } from "@carbon/react";

/** Carbon theme zones an app may render: the light "White" surface, or the dark "Gray 100". */
export type AllyCarbonTheme = "white" | "g100";

export interface AllyThemeProviderProps {
  children: ReactNode;
  /**
   * Carbon theme zone. Defaults to `"white"`, which every app uses; the admin
   * console passes `"g100"` while its dark mode is on.
   */
  theme?: AllyCarbonTheme;
}

/**
 * The single design-system theme boundary for every app in the monorepo.
 *
 * Renders Carbon's `<GlobalTheme>` so all `@carbon/react` components (used
 * through `@ally-ui-mono/ui-shared`) resolve the `--cds-*` design tokens to
 * the chosen surface — "White" unless an app opts into dark. The `"use client"`
 * directive lets this be dropped straight into the Next.js App Router server
 * tree in ally-web (Carbon's GlobalTheme is a context component); it is
 * harmless in the Vite apps.
 */
export function AllyThemeProvider({ children, theme = "white" }: AllyThemeProviderProps) {
  return <GlobalTheme theme={theme}>{children}</GlobalTheme>;
}

export default AllyThemeProvider;
