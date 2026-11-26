import React from "react";

import { useParams } from "react-router-dom";

import { ManualShell } from "./ManualShell";

/**
 * `/roadmap/manual` and `/roadmap/manual/:slug`. Lazy-loaded by the router, inside RoadmapGate and
 * RoadmapFrame like the other Roadmap pages. A slug that isn't in the manual still reaches the page
 * view, which says so in words.
 */
export const RoadmapManualPage: React.FC = () => {
  const { slug } = useParams<{ slug?: string }>();
  return <ManualShell slug={slug ?? null} />;
};

export default RoadmapManualPage;
