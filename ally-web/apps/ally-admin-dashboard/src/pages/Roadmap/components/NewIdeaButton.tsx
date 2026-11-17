import React from "react";

import { Plus } from "@icons";
import { useNavigate } from "react-router-dom";

import { Button, OverflowMenu, OverflowMenuItem } from "@ally-ui-mono/ui-shared";
import { ROUTES, en } from "@constants";

/**
 * The header's one primary button (§4.1): New idea, with Report a bug in its menu. It opens the
 * draft page at once; the draft and its code exist as soon as there are words (§4.2).
 */
export const NewIdeaButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const navigate = useNavigate();
  const copy = en.roadmapV2.newIdea;
  return (
    <span className="inline-flex items-center">
      <Button
        kind="primary"
        size={compact ? "md" : "sm"}
        renderIcon={() => <Plus size={16} aria-hidden />}
        onClick={() => navigate(ROUTES.ROADMAP_NEW_IDEA)}
      >
        {copy.button}
      </Button>
      <OverflowMenu
        aria-label={copy.moreActions}
        iconDescription={copy.moreActions}
        flipped
        size="sm"
      >
        <OverflowMenuItem
          itemText={copy.reportBug}
          onClick={() => navigate(`${ROUTES.PRODUCT_ROADMAP}?tab=bugs`)}
        />
      </OverflowMenu>
    </span>
  );
};
