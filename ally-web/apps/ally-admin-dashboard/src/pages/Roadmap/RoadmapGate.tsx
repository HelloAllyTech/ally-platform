import React, { createContext, useContext } from "react";

import { SkeletonText } from "@ally-ui-mono/ui-shared";
import { useGetRoadmapMeRoleQuery } from "@api";
import type { RoadmapMeRole } from "@types";

/**
 * Roadmap v2 is dark behind `roadmap_v2`: every `/v1/roadmap/*` route answers 404 while it is off.
 * `GET /v1/roadmap/me/role` succeeding is therefore the flag check — on and off, and the caller's
 * role — in one request. Anything else (404, 403, a network failure) renders `fallback`, so with the
 * flag off `/roadmap` is the app's ordinary not-found page and nothing else changes.
 */
const RoadmapRoleContext = createContext<RoadmapMeRole | null>(null);

export const useRoadmapRole = (): RoadmapMeRole => {
  const value = useContext(RoadmapRoleContext);
  return value ?? { role: "none", can: {} };
};

interface RoadmapGateProps {
  children: React.ReactNode;
  /** Shown when the flag is off or the caller has no Roadmap role. */
  fallback: React.ReactNode;
}

export const RoadmapGate: React.FC<RoadmapGateProps> = ({ children, fallback }) => {
  const { data, isLoading, isError } = useGetRoadmapMeRoleQuery();
  if (isLoading) {
    return (
      <div className="p-6" aria-busy="true">
        <SkeletonText heading />
        <SkeletonText paragraph lineCount={6} />
      </div>
    );
  }
  if (isError || !data || data.role === "none") return <>{fallback}</>;
  return <RoadmapRoleContext.Provider value={data}>{children}</RoadmapRoleContext.Provider>;
};

/** For tests and stories: provide a role without the request. */
export const RoadmapRoleProvider = RoadmapRoleContext.Provider;
