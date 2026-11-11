import React from "react";

import { ContextCollectionLink } from "@components/context-collection-link";
import { en } from "@constants";

/** The Debrief Guidance collection, which the Debrief agent reads beside each important moment. */
export const DEBRIEF_GUIDANCE_COLLECTION = "debrief_guidance";

/**
 * Debriefs → Guidance: the guidance the Debrief agent looks up moved into the Context Library's
 * Debrief Guidance (docs/context-library/PLAN.md §9.7), where it is written, targeted at
 * organisations and archived. Clinical sign-off went with it: the `clinical` mark is shown there
 * as information. This tab points there instead of keeping a second copy.
 */
export const GuidanceTab: React.FC = () => (
  <div className="max-w-3xl">
    <ContextCollectionLink collection={DEBRIEF_GUIDANCE_COLLECTION} copy={en.debriefs.guidance} />
  </div>
);
