import React from "react";

import { RoadmapTopNav } from "./RoadmapTopNav";

/**
 * The top menu for the Roadmap's pages past the Queue (Drafts, Bugs, Agent, Settings, Measures):
 * the same {@link RoadmapTopNav} as the Queue, so the tabs stay where they are as you move.
 */
export const RoadmapAreaHeader: React.FC<{ phone: boolean; current: string }> = ({
  phone,
  current,
}) => <RoadmapTopNav phone={phone} phoneTitle={current} />;
