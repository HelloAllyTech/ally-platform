import React from "react";

import { en } from "@constants";
import { CourseCopilotSessionStatus } from "@types";

/**
 * Colour per state: blue while the copilot is working with you, amber when it is waiting on your
 * approval, red when it needs attention, green once there is a course to edit.
 */
const STATUS_CLASSES: Record<CourseCopilotSessionStatus, string> = {
  INTERVIEWING: "bg-primary-50 text-primary-700",
  AWAITING_BLUEPRINT: "bg-warning-50 text-warning-text",
  BUILDING: "bg-primary-100 text-primary-800",
  BUILD_FAILED: "bg-destructive-50 text-destructive-600",
  EDITING: "bg-success-50 text-success-600",
  ARCHIVED: "bg-neutral-100 text-neutral-600",
};

/**
 * A session's status as a pill.
 *
 * A styled span, not Carbon's `<Tag>`: Tag renders a `<button>`, and the sessions list puts this
 * inside a clickable card (a button in a button is invalid DOM and steals the click).
 */
export const CourseCopilotStatusTag: React.FC<{ status: CourseCopilotSessionStatus }> = ({
  status,
}) => (
  <span
    className={[
      "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
      STATUS_CLASSES[status] ?? "bg-neutral-100 text-neutral-600",
    ].join(" ")}
  >
    {en.courseCopilot.status[status] ?? status}
  </span>
);
