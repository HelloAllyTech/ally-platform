import React, { useState } from "react";

import { Debug } from "@icons";
import { createPortal } from "react-dom";

import { IdeaCaptureLauncher } from "@components/idea-capture/IdeaCapture";
import { en } from "@constants";

import { RoadmapIconButton } from "./RoadmapIconButton";
import { ReportBugModal } from "../../ProductRoadmap/ReportBugModal";

/**
 * The header's two ways to add: a bulb for an idea (the one shared idea-capture button, the same
 * mic-bulb as the nav and the phone bar) and a bug for a bug report. Save makes the private draft
 * and opens it; the draft and its code exist as soon as there are words (§4.2).
 *
 * The bug opens the staff bug report form full-screen, right where the reporter is — it used to
 * jump to the Bugs list, which made filing a bug two steps and lost the screen it was seen on.
 * The Bugs list is still one tab away (and in the phone bar). It is portalled to <body>: rendered
 * here, inside the header's stacking context, the side nav painted over the form's left edge.
 */
export const NewIdeaButton: React.FC = () => {
  const [isReportBugOpen, setIsReportBugOpen] = useState(false);
  const copy = en.roadmapV2.newIdea;
  return (
    <span className="inline-flex items-center gap-1">
      <IdeaCaptureLauncher />
      <RoadmapIconButton label={copy.reportBug} onClick={() => setIsReportBugOpen(true)}>
        <Debug size={20} aria-hidden />
      </RoadmapIconButton>
      {isReportBugOpen &&
        createPortal(<ReportBugModal onClose={() => setIsReportBugOpen(false)} />, document.body)}
    </span>
  );
};
