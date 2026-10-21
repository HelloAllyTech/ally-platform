import { createContext, useContext } from "react";

/**
 * Who the Analytics page is scoped for. A platform admin restricted to some
 * organizations (`restrictedTenantIds` on /v1/users/me) sees one of their
 * orgs at a time: the backend refuses them any chart that spans every
 * organization, and any org-scoped chart that names no org or another org.
 *
 * So for them `tenantId` is always set — the page-level org picker's choice —
 * and every request a panel makes must carry it. Panels that make a
 * platform-wide request skip it (and hide the card) when `restricted`.
 */
export interface AnalyticsOrgScope {
  restricted: boolean;
  /** The org a restricted admin is looking at. Undefined for everyone else. */
  tenantId?: string;
}

const AnalyticsOrgScopeContext = createContext<AnalyticsOrgScope>({ restricted: false });

export const AnalyticsOrgScopeProvider = AnalyticsOrgScopeContext.Provider;

export const useAnalyticsOrgScope = (): AnalyticsOrgScope => useContext(AnalyticsOrgScopeContext);
