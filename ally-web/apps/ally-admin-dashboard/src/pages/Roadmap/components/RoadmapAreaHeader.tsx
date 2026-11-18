import React from "react";

import { RoadmapTopNav } from "./RoadmapTopNav";

/**
 * The title bar of a Roadmap page on a phone. Everywhere else the Roadmap's sub navigation is drawn
 * once by the frame, so the tabs stay exactly where they are as you move between pages.
 */
export const RoadmapAreaHeader: React.FC<{ phone: boolean; current: string }> = ({
  phone,
  current,
}) => (phone ? <RoadmapTopNav phone phoneTitle={current} /> : null);
