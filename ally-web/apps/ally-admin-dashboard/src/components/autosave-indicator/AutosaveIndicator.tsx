import { FC } from "react";

import { en } from "@constants/en";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

export const AutosaveIndicator: FC<{ status: AutosaveStatus; savedAt?: Date | null }> = ({
  status,
  savedAt,
}) => {
  if (status === "idle") return null;
  const copy = en.adminUx.autosave;
  const text =
    status === "saving"
      ? copy.saving
      : status === "error"
        ? copy.failed
        : savedAt
          ? copy.savedAt(savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
          : copy.saved;
  return (
    <span
      role="status"
      aria-live="polite"
      className={`text-xs ${status === "error" ? "text-red-600" : "text-typography-600"}`}
    >
      {text}
    </span>
  );
};
