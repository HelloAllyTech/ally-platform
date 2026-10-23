import React, { useState } from "react";

import { Button } from "@ally-ui-mono/ui-shared";
import { en } from "@constants";
import { BuilderPrFeedback, BuilderPullRequest } from "@types";

/** How many open findings show before the rest fold behind "Show N more". */
const FINDINGS_SHOWN = 3;

/** Open = Builder still means to act on it (or is acting on it right now). */
export const openFindingsFor = (
  pullRequestId: string,
  feedback: BuilderPrFeedback[] | undefined,
): BuilderPrFeedback[] =>
  (feedback ?? []).filter(
    item =>
      item.pullRequestId === pullRequestId &&
      (item.status === "pending" || item.status === "in_fix"),
  );

/** A finding's title: the first non-empty line of its body, without markdown markers. */
export const findingTitle = (body: string | null | undefined): string =>
  (body ?? "")
    .split("\n")
    .map(line =>
      line
        .replace(/^[#>*\-\s]+/, "")
        .replace(/\*\*/g, "")
        .trim(),
    )
    .find(Boolean) ?? "";

interface NeedsHumanBlockProps {
  pullRequest: BuilderPullRequest;
  findings: BuilderPrFeedback[];
  onResume: (pullRequestId: string) => void;
  /** True while this pull request's resume is in flight. */
  resuming: boolean;
  className?: string;
}

/**
 * What a person needs when Builder's review-and-fix loop has handed them a
 * pull request: the server's one-sentence reason, the findings still open, and
 * the way to give it back.
 *
 * The reason is rendered exactly as the server wrote it — it already says it
 * plainly ("3 fix rounds and 2 problems remain."), and paraphrasing it here
 * would let the two drift. Resume is secondary on purpose: the useful next
 * step is usually to read the pull request, not to send it round again.
 */
export const NeedsHumanBlock: React.FC<NeedsHumanBlockProps> = ({
  pullRequest,
  findings,
  onResume,
  resuming,
  className = "",
}) => {
  const strings = en.builder.build.needsYou;
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? findings : findings.slice(0, FINDINGS_SHOWN);
  const hidden = findings.length - shown.length;

  return (
    <div className={`flex flex-col gap-1 text-xs ${className}`.trim()}>
      {pullRequest.needsHumanReason && (
        <p className="text-typography-800">{pullRequest.needsHumanReason}</p>
      )}
      {findings.length > 0 && (
        <div>
          <p className="font-medium text-typography-600">{strings.openFindingsHeading}</p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {shown.map(item => (
              <li key={item.id} className="flex flex-wrap gap-x-2 text-typography-700">
                <span className="min-w-0">{findingTitle(item.body) || item.kind}</span>
                {item.path && (
                  <span className="font-mono text-typography-500">
                    {item.line != null ? `${item.path}:${item.line}` : item.path}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {findings.length > FINDINGS_SHOWN && (
            <button
              type="button"
              className="mt-0.5 text-primary-700 hover:underline"
              onClick={() => setExpanded(previous => !previous)}
              aria-expanded={expanded}
            >
              {expanded ? strings.showFewer : strings.showMore(hidden)}
            </button>
          )}
        </div>
      )}
      <div>
        <Button
          size="sm"
          kind="tertiary"
          title={strings.resumeHint}
          disabled={resuming}
          onClick={() => onResume(pullRequest.id)}
        >
          {resuming ? strings.resuming : strings.resume}
        </Button>
      </div>
    </div>
  );
};
