import React from "react";

import { en } from "@constants";

interface IssueSteerHintProps {
  /** The build's pull request, once opencode has opened one. */
  pullRequest: { repo: string | null; number: number; url: string | null } | null;
}

/**
 * Stands in for {@link SteerComposer} on an issue build.
 *
 * Builder does not run an issue build, so a note left here would never reach
 * the agent doing the work — opencode reads `/oc` comments on its pull request.
 * Offering the composer anyway would be a control that quietly does nothing,
 * so it is replaced outright, along with its history of notes read by runs
 * this session no longer has.
 */
export const IssueSteerHint: React.FC<IssueSteerHintProps> = ({ pullRequest }) => {
  const strings = en.builder.steer;
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
