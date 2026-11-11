import React from "react";

import { useNavigate } from "react-router-dom";

import { Button, InlineNotification, SkeletonText, Tag, Tile } from "@ally-ui-mono/ui-shared";
import { useGetBuilderExemplarsQuery } from "@api";
import { ContextCollectionLink } from "@components/context-collection-link";
import { en, ROUTES } from "@constants";
import { BuilderExemplar } from "@types";
import { asAgentTextList } from "@utils";

import { BUILDER_OUTCOME_TAG_TYPE } from "./builderMotion";
import { formatHours, formatScoreboardCost } from "./scoreboardChart";

/** The Context Library collection Builder's lessons live in (PLAN §2.2, phase 5). */
export const BUILDER_LESSONS_COLLECTION = "builder_lessons";

/* -------------------------------------------------------------------------- */
/* Exemplars                                                                  */
/* -------------------------------------------------------------------------- */

const ExemplarCard: React.FC<{ exemplar: BuilderExemplar }> = ({ exemplar }) => {
  const strings = en.builder.knowledge.exemplars;
  const navigate = useNavigate();
  const failureTags = asAgentTextList(exemplar.failureTags);

  return (
    <Tile
      className="cursor-pointer hover:border-primary-400"
      onClick={() => navigate(ROUTES.BUILDER_SESSION(exemplar.sessionId))}
      role="button"
      tabIndex={0}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigate(ROUTES.BUILDER_SESSION(exemplar.sessionId));
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-typography-900">{exemplar.title}</p>
          <p className="mt-0.5 truncate text-xs text-typography-500">{exemplar.repos.join(", ")}</p>
        </div>
        <Tag type={BUILDER_OUTCOME_TAG_TYPE[exemplar.outcome]} size="sm" className="shrink-0">
          {en.builder.scoreboard.outcome[exemplar.outcome] ?? exemplar.outcome}
        </Tag>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-typography-600">
        <span>{formatScoreboardCost(exemplar.costUsd)}</span>
        <span>{exemplar.fixRunCount} fix runs</span>
        <span>{exemplar.reviewCommentCount} review comments</span>
        <span>{exemplar.ciFailureCount} CI failures</span>
        <span>{formatHours(exemplar.timeToMergeHours)} to merge</span>
      </div>
      {exemplar.summaryMd && (
        <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-typography-600">
          {exemplar.summaryMd}
        </p>
      )}
      <p className="mt-2 text-xs text-typography-400">
        {failureTags.length ? failureTags.join(", ") : strings.noFailureTags}
      </p>
    </Tile>
  );
};

const ExemplarsTab: React.FC = () => {
  const strings = en.builder.knowledge.exemplars;
  const { data, isLoading, isError } = useGetBuilderExemplarsQuery();
  const exemplars = data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-typography-600">{strings.caption}</p>

      {isError && (
        <InlineNotification kind="error" lowContrast hideCloseButton title={strings.loadFailed} />
      )}

      {isLoading ? (
        <SkeletonText paragraph lineCount={6} />
      ) : exemplars.length === 0 ? (
        <p className="mt-6 text-center text-sm text-typography-500">{strings.empty}</p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {exemplars.map(exemplar => (
            <ExemplarCard key={exemplar.id} exemplar={exemplar} />
          ))}
        </div>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * What Builder has learned across past builds, and the runs worth reading in full. The lessons
 * themselves are the Context Library's Builder Lessons collection — curated there by the agent
 * curator, and added to, edited, pinned or archived there by people — so this page links to them
 * rather than keeping a second copy of the list. An exemplar is a whole build, picked for being
 * unusually clean or unusually expensive, so a person can read the real transcript behind a
 * pattern rather than trust a summary of it.
 */
export const BuilderKnowledge: React.FC = () => {
  const strings = en.builder.knowledge;
  const navigate = useNavigate();

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 overflow-y-auto md:p-6">
      <header>
        <Button kind="ghost" size="sm" onClick={() => navigate(ROUTES.BUILDER)}>
          ← {strings.backToBuilder}
        </Button>
        <h1 className="mt-2 text-xl font-semibold text-typography-900">{strings.title}</h1>
        <p className="mt-1 text-sm text-typography-600">{strings.subtitle}</p>
      </header>

      <ContextCollectionLink collection={BUILDER_LESSONS_COLLECTION} copy={strings.lessonsLink} />

      <ExemplarsTab />
    </div>
  );
};
