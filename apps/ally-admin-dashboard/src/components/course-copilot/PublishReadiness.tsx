import React from "react";

import { CheckCircle, WarningAlt } from "@icons";

import { en } from "@constants";
import type { CoursePublishReadiness } from "@types";
import { asAgentText } from "@utils";

import { asArray } from "./courseCopilotFormat";

export type PublishCheck = CoursePublishReadiness["checks"][number];

export interface PublishReadinessProps {
  readiness: CoursePublishReadiness | null | undefined;
  /**
   * Offered beside each unmet check when the copilot can act on it (EDITING, not mid-turn):
   * hands the check to the copilot as a request instead of leaving the trainer to phrase it.
   */
  onAskCopilot?: (check: PublishCheck) => void;
}

/**
 * The publish checklist, mirroring the server's `validateTrackForPublish`. The heading is
 * the answer ("Ready to publish" / "Needs: …") and the list is the evidence, so a trainer
 * who only reads the heading still knows what to do next.
 *
 * Publishing stays an explicit act in chat or in the editor — this panel reports, it
 * never publishes (Stacks, "Progressive Delegation: Staged Autonomy Growth": draft first,
 * publish only on explicit confirmation).
 */
export const PublishReadiness: React.FC<PublishReadinessProps> = ({ readiness, onAskCopilot }) => {
  const strings = en.courseCopilotPane.course.readiness;
  if (!readiness || typeof readiness !== "object") return null;

  const checks = asArray<CoursePublishReadiness["checks"][number]>(readiness.checks).filter(
    check => check && typeof check === "object",
  );
  const unmet = checks.filter(check => !check.ok);
  // The server's own verdict decides the heading; the checks only name what is missing.
  const ready = Boolean(readiness.ready);

  if (checks.length === 0 && !ready) return null;

  return (
    <section aria-label={strings.heading} className="space-y-2">
      <h3
        className={`flex items-center gap-1.5 text-sm font-semibold ${
          ready ? "text-success-600" : "text-typography-900"
        }`}
      >
        {ready ? (
          <CheckCircle className="h-4 w-4 shrink-0" />
        ) : (
          <WarningAlt className="h-4 w-4 shrink-0 text-warning-500" />
        )}
        {ready
          ? strings.ready
          : strings.needs(unmet.map(check => asAgentText(check.label)).filter(Boolean))}
      </h3>
      {checks.length > 0 && (
        <ul className="space-y-1">
          {checks.map(check => {
            const detail = asAgentText(check.detail).trim();
            return (
              <li key={check.key} className="flex items-start gap-2 text-sm">
                {check.ok ? (
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-success-500" />
                ) : (
                  <WarningAlt className="mt-0.5 h-4 w-4 shrink-0 text-warning-500" />
                )}
                <span className="min-w-0 flex-1">
                  <span className={check.ok ? "text-typography-800" : "text-typography-900"}>
                    {asAgentText(check.label)}
                  </span>
                  {detail && <span className="block text-xs text-typography-700">{detail}</span>}
                </span>
                {!check.ok && onAskCopilot && (
                  <button
                    type="button"
                    onClick={() => onAskCopilot(check)}
                    className="shrink-0 text-xs font-medium text-primary-600 hover:underline"
                  >
                    {strings.askCopilot}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
