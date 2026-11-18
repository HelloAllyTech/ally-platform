import React from "react";

import { Debug } from "@icons";
import { useNavigate } from "react-router-dom";

import { IdeaCaptureLauncher } from "@components/idea-capture/IdeaCapture";
import { ROUTES, en } from "@constants";

import { RoadmapIconButton } from "./RoadmapIconButton";

/**
 * The header's two ways to add: a bulb for an idea (the one shared idea-capture button, the same
 * mic-bulb as the nav and the phone bar) and a bug for a bug report. Save makes the private draft
 * and opens it; the draft and its code exist as soon as there are words (§4.2).
 */
export const NewIdeaButton: React.FC = () => {
  const navigate = useNavigate();
  const copy = en.roadmapV2.newIdea;
  return (
    <span className="inline-flex items-center gap-1">
      <IdeaCaptureLauncher />
      <RoadmapIconButton label={copy.reportBug} onClick={() => navigate(ROUTES.ROADMAP_BUGS)}>
        <Debug size={20} aria-hidden />
      </RoadmapIconButton>
    </span>
  );
};
