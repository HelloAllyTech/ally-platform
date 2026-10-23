import React from "react";

import { en } from "@constants";

interface IssueSteerHintProps {
  /** The build's pull request, once opencode has opened one. */
  pullRequest: { repo: string | null; number: number; url: string | null } | null;
  /**
   * A repo chain: one line and no link — the table above already links every
   * pull request, and naming one here would be a seventh copy of its number.
   */
  chained?: boolean;
}

/**
 * How to steer an issue build.
 *
 * Builder does not run an issue build, so it has no channel of its own to the
 * agent doing the work — opencode reads `/oc` comments on its pull request.
 */
export const IssueSteerHint: React.FC<IssueSteerHintProps> = ({ pullRequest, chained = false }) => {
  const strings = en.builder.steer;
  if (chained) {
    return (
      <p className="border-t border-border-light px-4 py-3 text-xs text-typography-600">
        {strings.issueHintChain}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 border-t border-border-light p-4">
      <h3 className="text-sm font-medium">{strings.issueTitle}</h3>
      <p className="text-xs text-typography-600">
        {pullRequest ? strings.issueHint : strings.issueHintNoPr}
      </p>
      {pullRequest?.url && (
        <a
          href={pullRequest.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary-700 hover:underline"
        >
          {strings.issueOpenPr(pullRequest.repo ?? "", pullRequest.number)}
        </a>
      )}
    </div>
  );
};
