import { FC, ReactNode, useEffect, useMemo, useState } from "react";

import { useSelector } from "react-redux";

import { useGetLogoUrlQuery, useGetPublicBrandingQuery } from "@api";
import { SESSION_STORAGE_KEYS } from "@constants";
import { RootState } from "@store";

import { applyBranding, cacheBranding, isBrandingOn } from "./applyBranding";
import { ALLY_BRANDING, BrandingContext, hasRouteOverride } from "./BrandingContext";

/**
 * Resolves which organization's branding this page should wear and keeps
 * the document painted to match.
 *
 *  - Signed in: the user's own org, from `GET /v1/users/tenant` (the same
 *    query the sidebar reads for the logo, so no extra request).
 *  - Signed out with `?org=<code>` on the URL (an org's own sign-in link):
 *    that org, from the public branding route. The code is kept for the
 *    tab, so the OTP step and a session-expiry bounce stay branded.
 *  - Otherwise: Ally, and the reload cache is cleared so the next visitor on
 *    this browser does not inherit a previous org's colours.
 *
 * Sits outside the router on purpose: it reads the org code from
 * `window.location` once, which is all the login link needs.
 */

const readOrgCode = (): string | null => {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("org")?.trim();
    if (fromUrl) {
      sessionStorage.setItem(SESSION_STORAGE_KEYS.LOGIN_ORG_CODE, fromUrl);
      return fromUrl;
    }
    return sessionStorage.getItem(SESSION_STORAGE_KEYS.LOGIN_ORG_CODE);
  } catch {
    return null;
  }
};

export const BrandingProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const isAuthenticated = useSelector((state: RootState) => state.user.isAuthenticated);
  const [orgCode] = useState(readOrgCode);

  const { data: tenant } = useGetLogoUrlQuery(undefined, { skip: !isAuthenticated });
  const { data: publicBranding, isError: publicMissing } = useGetPublicBrandingQuery(
    orgCode ?? "",
    { skip: isAuthenticated || !orgCode },
  );

  // `undefined` while the relevant request is in flight; a value once it has
  // answered. Ally when nothing applies, so the effect below can clear.
  const resolved = useMemo(() => {
    if (isAuthenticated) return tenant ? (tenant.branding ?? ALLY_BRANDING) : undefined;
    if (orgCode) {
      if (publicBranding) return publicBranding;
      return publicMissing ? ALLY_BRANDING : undefined;
    }
    return ALLY_BRANDING;
  }, [isAuthenticated, tenant, orgCode, publicBranding, publicMissing]);

  useEffect(() => {
    if (resolved === undefined) return;
    cacheBranding(resolved);
    // A route that brands itself (the talker page) owns the document for now.
    if (hasRouteOverride()) return;
    applyBranding(isBrandingOn(resolved) ? resolved : null);
  }, [resolved]);

  const value = useMemo(() => {
    const branding = resolved ?? ALLY_BRANDING;
    return { branding, enabled: isBrandingOn(branding) };
  }, [resolved]);

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
};

export default BrandingProvider;
