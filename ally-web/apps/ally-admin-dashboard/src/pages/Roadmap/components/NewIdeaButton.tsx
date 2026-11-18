import React from "react";

import { useNavigate } from "react-router-dom";

import { OverflowMenu, OverflowMenuItem } from "@ally-ui-mono/ui-shared";
import { IdeaCaptureLauncher } from "@components/idea-capture/IdeaCapture";
import { ROUTES, en } from "@constants";

/**
 * The header's New idea control (§4.1): the one shared idea-capture button (the same mic-bulb as
 * the nav and the phone bar), with Report a bug in its menu. Save makes the private draft and
 * opens it; the draft and its code exist as soon as there are words (§4.2).
 */
export const NewIdeaButton: React.FC = () => {
  const navigate = useNavigate();
  const copy = en.roadmapV2.newIdea;
  return (
    <span className="inline-flex items-center">
      <IdeaCaptureLauncher />
      <OverflowMenu
        aria-label={copy.moreActions}
        iconDescription={copy.moreActions}
        flipped
        size="sm"
      >
        <OverflowMenuItem itemText={copy.reportBug} onClick={() => navigate(ROUTES.ROADMAP_BUGS)} />
      </OverflowMenu>
    </span>
  );
};
