import React, { useEffect } from "react";

import {
  useGetRoadmapCommentsQuery,
  useGetRoadmapOpportunityBriefQuery,
  useGetRoadmapOpportunityQuery,
  useRoadmapAiDuplicatesMutation,
} from "@api";
import { en } from "@constants/en";
import { RoadmapOpportunity } from "@types";

import { RankScore } from "./RankBreakdown";
import { RankWhy } from "./RankWhy";
import { useScoreUnit } from "./useScoreUnit";
import { monthLabel } from "./utils/monthBoard";
import { personName } from "./utils/people";
import { formatPoints } from "./utils/points";
import { EFFORT_LABEL, SOURCE_LABEL, stageLabel, stageStyle } from "./utils/stages";
import { formatAge } from "./utils/triage";

interface OpportunityPeekProps {
  opportunityId: string;
  /** Managers get the decision buttons; everyone else reads. */
  canManage: boolean;
  onClose: () => void;
  /** The full drawer — for the deep work the peek is not for. */
  onOpenFull: () => void;
  onAccept: (opportunity: RoadmapOpportunity) => void;
  onReject: (opportunity: RoadmapOpportunity) => void;
  onRestore: (opportunity: RoadmapOpportunity) => void;
  /** Look at a possible duplicate in this same panel. */
  onOpenOther: (id: string) => void;
  /** Start a merge of this opportunity with that one. Managers only. */
  onMerge: (opportunityId: string, otherId: string) => void;
}

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex justify-between gap-3 text-sm">
    <dt className="text-typography-secondary shrink-0">{label}</dt>
    <dd className="text-typography-primary min-w-0 break-words text-right">{children}</dd>
  </div>
);

/**
 * The triage peek: a non-modal ~420px pane on the right that follows the keyboard cursor.
 *
 * Not a dialog, on purpose. The modal drawer made every decision four or five clicks and hid the
 * list; this keeps the list on screen and responsive (`j`/`k` move the peek), so deciding on the
 * next one costs one key. It carries what a triager needs to decide — the whole description, the
 * facts the row leaves out (owner, month, source, who filed it and how long ago), the brief, and
 * the comments — and "Open full" is there for everything else.
 *
 * It fetches the opportunity by id rather than trusting the list row: the row is a projection,
 * and the peek must also work for an id arriving from a link.
 */
export const OpportunityPeek: React.FC<OpportunityPeekProps> = ({
  opportunityId,
  canManage,
  onClose,
  onOpenFull,
  onAccept,
  onReject,
  onRestore,
  onOpenOther,
  onMerge,
}) => {
  const { unit } = useScoreUnit();
  const {
    data: opportunity,
    isLoading,
    isError,
    refetch,
  } = useGetRoadmapOpportunityQuery(opportunityId);
  const { data: comments } = useGetRoadmapCommentsQuery(opportunityId);
  const { data: briefResult } = useGetRoadmapOpportunityBriefQuery(opportunityId, {
    skip: !opportunity?.hasBrief,
  });
  const brief = briefResult?.brief ?? null;

  // Possible duplicates: the existing similarity endpoint, asked once per opportunity shown. It
  // is a mutation (it embeds the text), so it is fired from an effect keyed on the id and the
  // description — not on every render, and not on the polling that refreshes `opportunity`.
  const [findDuplicates, duplicatesState] = useRoadmapAiDuplicatesMutation();
  const description = opportunity?.description;
  const productGoal = opportunity?.productGoal;
  useEffect(() => {
    if (!description) return;
    void findDuplicates({ description, productGoal }).catch(() => undefined);
  }, [opportunityId, description, productGoal, findDuplicates]);
  // The opportunity matches itself; it is not a duplicate of itself.
  const duplicates = (duplicatesState.data?.matches ?? [])
    .filter(match => match.id !== opportunityId)
    .slice(0, 5);

  const [heading, ...rest] = (opportunity?.description ?? "").split("\n");
  const body = rest.join("\n").trim();
  const isArchived = opportunity?.stage === "archived";
  const canAccept = opportunity?.stage === "new";
  const canReject = !!opportunity && !isArchived && opportunity.stage !== "released";

  return (
    <aside
      aria-label={en.roadmapTriage.peekTitle}
      className="border-border-light fixed right-0 top-0 z-30 flex h-full w-full flex-col overflow-y-auto border-l bg-white shadow-lg md:w-[26rem]"
    >
      <div className="border-border-light flex items-center justify-between gap-2 border-b px-4 py-3">
        <span className="text-typography-secondary text-sm tabular-nums">
          {opportunity?.code ?? ""}
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenFull}
            className="text-primary-500 cursor-pointer text-sm hover:underline"
          >
            {en.roadmapTriage.peekOpenFull}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={en.roadmapTriage.peekClose}
            className="text-typography-secondary hover:text-typography-primary cursor-pointer text-lg leading-none"
          >
            ×
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-typography-secondary p-4 text-sm">Loading…</p>
      ) : isError || !opportunity ? (
        <div role="alert" className="flex flex-col items-start gap-2 p-4 text-sm">
          <p className="text-typography-primary">Couldn't load this opportunity.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="text-primary-500 cursor-pointer hover:underline"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-5 p-4">
          <div className="flex flex-col gap-2">
            <span className={`w-fit px-1.5 py-0.5 text-xs ${stageStyle(opportunity.stage)}`}>
              {stageLabel(opportunity.stage)}
            </span>
            <h2 className="text-typography-primary break-words text-base font-medium">{heading}</h2>
            {body && (
              <p className="text-typography-secondary whitespace-pre-wrap break-words text-sm">
                {body}
              </p>
            )}
          </div>

          {canManage && (canAccept || canReject || isArchived) && (
            <div className="flex flex-wrap gap-2">
              {canAccept && (
                <button
                  type="button"
                  onClick={() => onAccept(opportunity)}
                  className="bg-primary-500 hover:bg-primary-700 cursor-pointer px-3 py-1.5 text-sm text-white"
                >
                  {en.roadmapTriage.peekAccept}
                </button>
              )}
              {canReject && (
                <button
                  type="button"
                  onClick={() => onReject(opportunity)}
                  className="border-border-light hover:border-primary-500 cursor-pointer border px-3 py-1.5 text-sm"
                >
                  {en.roadmapTriage.peekReject}
                </button>
              )}
              {isArchived && (
                <button
                  type="button"
                  onClick={() => onRestore(opportunity)}
                  className="border-border-light hover:border-primary-500 cursor-pointer border px-3 py-1.5 text-sm"
                >
                  {en.roadmapTriage.peekRestore}
                </button>
              )}
            </div>
          )}

          <section aria-label={en.roadmapTriage.peekFacts} className="flex flex-col gap-2">
            <h3 className="text-typography-primary text-sm font-medium">
              {en.roadmapTriage.peekFacts}
            </h3>
            <dl className="flex flex-col gap-1.5">
              <Fact label="Rank">
                {opportunity.queueRank !== null ? `#${opportunity.queueRank} · ` : ""}
                <RankScore opportunity={opportunity} /> <RankWhy opportunity={opportunity} />
              </Fact>
              <Fact label={unit === "points" ? "Points" : "Votes"}>
                {formatPoints(opportunity.priorityScore)} · {opportunity.voterCount}{" "}
                {opportunity.voterCount === 1 ? "backer" : "backers"}
              </Fact>
              <Fact label="Goal">{opportunity.productGoal}</Fact>
              <Fact label="Effort">
                {opportunity.effort ? EFFORT_LABEL[opportunity.effort] : "Not sized"}
              </Fact>
              <Fact label="Owner">{opportunity.owner ?? en.roadmapTriage.unowned}</Fact>
              <Fact label="Planned">
                {opportunity.plannedMonth ? monthLabel(opportunity.plannedMonth) : "Unscheduled"}
              </Fact>
              <Fact label="Filed">
                {formatAge(opportunity.createdAt)}
                {opportunity.creator ? ` by ${personName(opportunity.creator)}` : ""}
              </Fact>
              <Fact label="Source">{SOURCE_LABEL[opportunity.source] ?? opportunity.source}</Fact>
              <Fact label="Comments">{opportunity.commentCount}</Fact>
            </dl>
          </section>

          {brief && (
            <section aria-label="Brief" className="flex flex-col gap-1.5">
              <h3 className="text-typography-primary text-sm font-medium">Brief</h3>
              <p className="text-typography-secondary text-sm">{brief.assessment.summary}</p>
              {brief.successMetric && (
                <p className="text-typography-secondary text-sm">
                  <span className="text-typography-primary">Success: </span>
                  {brief.successMetric}
                </p>
              )}
            </section>
          )}

          <section aria-label={en.roadmapTriage.peekDuplicates} className="flex flex-col gap-1.5">
            <h3
              className="text-typography-primary text-sm font-medium"
              title={en.roadmapTriage.peekDuplicatesTip}
            >
              {en.roadmapTriage.peekDuplicates}
            </h3>
            {duplicatesState.isLoading ? (
              <p className="text-typography-secondary text-sm">Checking…</p>
            ) : duplicatesState.isError ? (
              <p className="text-typography-secondary text-sm">
                {en.roadmapTriage.peekDuplicatesError}
              </p>
            ) : duplicates.length === 0 ? (
              <p className="text-typography-secondary text-sm">
                {en.roadmapTriage.peekDuplicatesNone}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {duplicates.map(match => (
                  <li key={match.id} className="text-sm">
                    <button
                      type="button"
                      onClick={() => onOpenOther(match.id)}
                      className="text-primary-500 cursor-pointer text-left hover:underline"
                    >
                      {match.description.split("\n")[0]}
                    </button>
                    <p className="text-typography-secondary text-xs">
                      {Math.round(match.similarity * 100)}% similar · {stageLabel(match.stage)}
                      {canManage && (
                        <>
                          {" · "}
                          <button
                            type="button"
                            onClick={() => onMerge(opportunityId, match.id)}
                            className="text-primary-500 cursor-pointer hover:underline"
                          >
                            Merge…
                          </button>
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Comments" className="flex flex-col gap-1.5">
            <h3 className="text-typography-primary text-sm font-medium">Comments</h3>
            {!comments?.length ? (
              <p className="text-typography-secondary text-sm">No comments yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {comments.map(comment => (
                  <li key={comment.id} className="text-sm">
                    <p className="text-typography-primary whitespace-pre-wrap break-words">
                      {comment.body}
                    </p>
                    <p className="text-typography-secondary text-xs">
                      {formatAge(comment.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </aside>
  );
};
