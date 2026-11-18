import { createContext, useContext, useEffect } from "react";

import type { TenantBranding } from "@types";

import { applyBranding, isBrandingOn, readCachedBranding } from "./applyBranding";

/**
 * Ally's own identity, as the backend would resolve it for an org with the
 * switch off. The context default, so a component rendered without the
 * provider (tests, storybooks) behaves exactly like an unbranded org.
 */
export const ALLY_BRANDING: TenantBranding = {
  enabled: false,
  displayName: "Ally",
  logoUrl: null,
  faviconUrl: null,
  primaryColor: "#264D8E",
  welcomeLine: null,
  poweredByAlly: true,
  tokens: {
    primary: {
      DEFAULT: "#264D8E",
      50: "#EEF1F6",
      100: "#DCE3ED",
      200: "#BAC6DB",
      300: "#93A6C7",
      400: "#637FAE",
      500: "#264D8E",
      600: "#1F3F74",
      700: "#183159",
      800: "#10203C",
      900: "#0A1425",
    },
    onPrimary: "#FAF9F5",
  },
};

export interface BrandingContextValue {
  /** Resolved branding for whoever is looking: the signed-in user's org, or the `?org=` on the login link. */
  branding: TenantBranding;
  /** `branding.enabled`, for the common "is any of this on?" check. */
  enabled: boolean;
}

export const BrandingContext = createContext<BrandingContextValue>({
  branding: ALLY_BRANDING,
  enabled: false,
});

export const useBranding = (): BrandingContextValue => useContext(BrandingContext);

/**
 * A route that brands the page from its own data (the public talker page,
 * which knows its org from the URL and has no signed-in user). While one is
 * mounted the provider leaves the document alone; React runs a child's
 * effects before its parent's, so without this the provider's "nobody signed
 * in, nothing on the URL → Ally" pass would land on top of the route's paint.
 */
let routeOverrides = 0;
export const hasRouteOverride = () => routeOverrides > 0;

export function useApplyBranding(branding: TenantBranding | null | undefined): void {
  useEffect(() => {
    routeOverrides += 1;
    return () => {
      routeOverrides -= 1;
      // Hand the document back: whatever the provider last cached, or Ally.
      applyBranding(readCachedBranding());
    };
  }, []);

  useEffect(() => {
    // Undefined means "still loading": keep whatever is painted rather than
    // flashing Ally for a page that is about to be branded.
    if (branding === undefined) return;
    applyBranding(isBrandingOn(branding) ? branding : null);
  }, [branding]);
}
