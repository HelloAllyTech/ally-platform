import { FC, useState } from "react";

import { en } from "@constants";
import { BugFixPostmortem, BugFixStudy } from "@types";
import { formatDateTime } from "@utils";

import { DetailLine, InfoTip } from "./FindingConfidence";

/**
 * What a fix session read and planned BEFORE it changed code. A reviewer
 * asking "is this diff the right shape" reads where the value lives and the
 * working sibling first; a wrong fix is usually traceable to a line in here.
 */
export const StudyDetails: FC<{ study: BugFixStudy }> = ({ study }) => (
  <div
    data-testid="finding-study"
    className="border border-sky-200 bg-sky-50 rounded p-3 flex flex-col gap-1.5"
  >
    <div className="flex items-center gap-1">
      <p className="text-xs font-medium text-sky-900">{en.bugHunter.drawerStudyTitle}</p>
      <InfoTip label={en.bugHunter.drawerStudyTooltip} />
    </div>
    {study.recordedAt && (
      <p className="text-[11px] text-typography-500">
        {en.bugHunter.drawerStudyRecorded.replace("{date}", formatDateTime(study.recordedAt))}
      </p>
    )}
    <DetailLine label={en.bugHunter.drawerStudyFeature} value={study.feature} />
    <div>
      <p className="text-[11px] text-typography-500">{en.bugHunter.drawerStudyHowItWorks}</p>
      <ol className="list-decimal pl-5 text-xs text-typography-700 flex flex-col gap-0.5">
        {study.howItWorksToday.map((step, i) => (
          <li key={i} className="break-words">
            {step}
          </li>
        ))}
      </ol>
    </div>
    <DetailLine
      label={en.bugHunter.drawerStudyValueLivesIn}
      value={en.bugHunter.drawerStudyValueHomes[study.valueLivesIn] ?? study.valueLivesIn}
      emphasis
    />
    {study.workingSibling && (
      <DetailLine label={en.bugHunter.drawerStudySibling} value={study.workingSibling} mono />
    )}
    <DetailLine label={en.bugHunter.drawerStudyRootCause} value={study.rootCause} />
    <DetailLine label={en.bugHunter.drawerStudyApproach} value={study.approach} emphasis />
    <DetailLine label={en.bugHunter.drawerStudyFiles} value={study.filesToChange.join("\n")} mono />
    {study.leaveAlone.length > 0 && (
      <DetailLine label={en.bugHunter.drawerStudyLeaveAlone} value={study.leaveAlone.join("\n")} />
    )}
    {study.otherRepos.length > 0 && (
      <DetailLine
        label={en.bugHunter.drawerStudyOtherRepos}
        value={study.otherRepos.join(", ")}
        mono
      />
    )}
    {study.risks.length > 0 && (
      <DetailLine label={en.bugHunter.drawerStudyRisks} value={study.risks.join("\n")} />
    )}
    <DetailLine label={en.bugHunter.drawerStudyTestPlan} value={study.testPlan} />
    {study.previousStudyWasWrongBecause && (
      <DetailLine
        label={en.bugHunter.drawerStudyPreviousWrong}
        value={study.previousStudyWasWrongBecause}
        emphasis
      />
    )}
    {study.review && (
      <div>
        <p className="text-[11px] text-typography-500">
          {(study.review.concerns.length
            ? en.bugHunter.drawerStudyReviewConcerns
            : en.bugHunter.drawerStudyReviewNone
          ).replace("{model}", study.review.model ?? en.bugHunter.drawerStudyReviewUnknownModel)}
        </p>
        {study.review.concerns.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-typography-700">
            {study.review.concerns.map((c, i) => (
              <li key={i} className="break-words">
                {c}
              </li>
            ))}
          </ul>
        )}
      </div>
    )}
  </div>
);

/**
 * What the last failed fix session wrote for whoever retries.
 *
 * Leads with the two lines that decide whether "Ask me to try again" is worth
 * pressing — why the fixes didn't hold, and what a retry should do differently
 * — and keeps the raw record (the failing output, the root-cause guess, the
 * repo trap) one click further down. Beside the retry button, the summary is
 * the decision; the rest is for when the summary isn't enough.
 */
export const PostmortemDetails: FC<{ postmortem: BugFixPostmortem }> = ({ postmortem }) => {
  const [showAll, setShowAll] = useState(false);
  const hasMore = Boolean(
    postmortem.lastFailure || postmortem.rootCauseHypothesis || postmortem.repoGotcha,
  );

  return (
    <div
      data-testid="finding-postmortem"
      className="border border-amber-200 bg-amber-50 rounded p-3 flex flex-col gap-1.5"
    >
      <div className="flex items-center gap-1">
        <p className="text-xs font-medium text-amber-800">{en.bugHunter.drawerPostmortemTitle}</p>
        <InfoTip label={en.bugHunter.drawerPostmortemTooltip} />
      </div>
      {(postmortem.attempts != null || postmortem.failingCheck) && (
        <p className="text-xs text-typography-700">
          {en.bugHunter.drawerPostmortemAttempts
            .replace("{count}", String(postmortem.attempts ?? "?"))
            .replace("{check}", postmortem.failingCheck ?? "")}
        </p>
      )}
      {postmortem.whyItFailed && (
        <DetailLine label={en.bugHunter.drawerPostmortemWhyFailed} value={postmortem.whyItFailed} />
      )}
      {postmortem.tryNext && (
        <DetailLine
          label={en.bugHunter.drawerPostmortemTryNext}
          value={postmortem.tryNext}
          emphasis
        />
      )}
      {hasMore && (
        <button
          type="button"
          className="text-xs text-primary-600 underline cursor-pointer self-start"
          aria-expanded={showAll}
          onClick={() => setShowAll(open => !open)}
        >
          {showAll ? en.bugHunter.drawerPostmortemHideAll : en.bugHunter.drawerPostmortemShowAll}
        </button>
      )}
      {showAll && (
        <>
          {postmortem.recordedAt && (
            <p className="text-[11px] text-typography-500">
              {en.bugHunter.drawerPostmortemRecorded.replace(
                "{date}",
                formatDateTime(postmortem.recordedAt),
              )}
            </p>
          )}
          {postmortem.lastFailure && (
            <DetailLine
              label={en.bugHunter.drawerPostmortemLastFailure}
              value={postmortem.lastFailure}
              mono
            />
          )}
          {postmortem.rootCauseHypothesis && (
            <DetailLine
              label={en.bugHunter.drawerPostmortemRootCause}
              value={postmortem.rootCauseHypothesis}
            />
          )}
          {postmortem.repoGotcha && (
            <DetailLine label={en.bugHunter.drawerPostmortemGotcha} value={postmortem.repoGotcha} />
          )}
        </>
      )}
    </div>
  );
};
