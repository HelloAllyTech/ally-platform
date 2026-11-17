import React from "react";

import { Navigate, useLocation } from "react-router-dom";

import { SkeletonText } from "@ally-ui-mono/ui-shared";
import { useGetBuilderNowQuery, useGetRoadmapMeRoleQuery } from "@api";

import { LegacyTarget, builderTarget, productRoadmapTarget } from "./utils/redirects";

/** `/builder/<id>` that isn't one of Builder's named pages: a session. */
const BUILDER_PAGES = new Set([
  "",
  "decisions",
  "settings",
  "sessions",
  "pipeline",
  "scoreboard",
  "knowledge",
  "eval",
]);
export const builderSessionIdOf = (pathname: string): string | null => {
  const rest = pathname.replace(/\/+$/, "").split("/builder")[1] ?? "";
  const segment = rest.replace(/^\//, "").split("/")[0] ?? "";
  return BUILDER_PAGES.has(segment) ? null : segment;
};

interface RoadmapLegacyRedirectProps {
  from: "productRoadmap" | "builder";
  children: React.ReactNode;
}

/**
 * Old Product Roadmap and Builder links land on the Roadmap (§5.7), only while `roadmap_v2` is on:
 * `GET /v1/roadmap/me/role` answering is the flag check, and anything else (404 with the flag off,
 * 403 without Roadmap access) renders the old page untouched. The landing carries `roadmapMoved` so
 * the Roadmap says "X is now Roadmap → Y" (§4.15). A Builder session with no idea keeps its old page,
 * which is its read-only archive.
 */
export const RoadmapLegacyRedirect: React.FC<RoadmapLegacyRedirectProps> = ({ from, children }) => {
  const location = useLocation();
  const { data: me, isLoading, isError } = useGetRoadmapMeRoleQuery();
  const flagOn = !!me && !isError && me.role !== "none";
  const sessionId = from === "builder" ? builderSessionIdOf(location.pathname) : null;
  const { data: now, isLoading: nowLoading } = useGetBuilderNowQuery(undefined, {
    skip: !flagOn || !sessionId,
  });

  if (isLoading || (flagOn && sessionId && nowLoading)) {
    return (
      <div className="p-6" aria-busy="true">
        <SkeletonText heading />
        <SkeletonText paragraph lineCount={4} />
      </div>
    );
  }
  if (!flagOn || !me) return <>{children}</>;

  let target: LegacyTarget | null;
  if (from === "productRoadmap") {
    target = productRoadmapTarget(location.search);
  } else {
    const sessions = Array.isArray(now?.sessions) ? now!.sessions : [];
    const match = sessionId ? sessions.find(s => s.id === sessionId) : undefined;
    target = builderTarget(location.pathname, me.role, match?.code ?? match?.opportunityId ?? null);
  }
  if (!target) return <>{children}</>;
  return (
    <Navigate
      to={target.to}
      replace
      state={{ roadmapMoved: { from: target.from, landed: target.landed } }}
    />
  );
};
