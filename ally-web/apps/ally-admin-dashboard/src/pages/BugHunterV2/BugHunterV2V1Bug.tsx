import { FC, ReactNode } from "react";

import { Link, useParams } from "react-router-dom";

import { InlineLoading, Tag } from "@ally-ui-mono/ui-shared";
import { useGetBugHunterV2V1BugQuery } from "@api";
import { en, ROUTES } from "@constants";
import { BugFindingSource, BugFindingStatus, BugHuntEventStage } from "@types";
import { formatDateTime } from "@utils";

import {
  BUG_FINDING_SOURCE_LABELS,
  BUG_FINDING_STATUS_LABELS,
} from "../BugHunter/bugFindingLabels";
import { BUG_HUNT_EVENT_STAGE_LABELS } from "../BugHunter/bugHuntEventLabels";

const TAB_TAG = {
  needs_you: "purple",
  failed: "red",
  in_progress: "blue",
  backlog: "gray",
  done: "green",
} as const;

const Section: FC<{ title: string; children: ReactNode }> = ({ title, children }) => (
  <section className="flex flex-col gap-2">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-typography-500">{title}</h2>
    {children}
  </section>
);

/**
 * One of the old Bug Hunter's findings, read-only, inside Bug Hunter v2: what it
 * found, what was decided, and its history. The board shows v1's history so the
 * reader never has to leave v2; acting on the bug is still the old Bug Hunter's.
 */
export const BugHunterV2V1Bug: FC = () => {
  const strings = en.bugHunterV2.v1Bug;
  const { findingId = "" } = useParams();
  const {
    data: b,
    isLoading,
    isError,
  } = useGetBugHunterV2V1BugQuery(findingId, {
    skip: !findingId,
  });

  if (isLoading) return <InlineLoading />;
  if (isError || !b) {
    return (
      <p className="p-6 text-sm text-support-error" role="alert">
        {strings.loadError}
      </p>
    );
  }
  const source = b.source.replace(/^v1:/, "");

  return (
    <div className="flex max-w-5xl flex-col gap-6 p-6" data-testid="bug-hunter-v2-v1-bug">
      <Link to={ROUTES.BUG_HUNTER_V2} className="text-sm text-primary-600">
        ← {en.bugHunterV2.back}
      </Link>
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-typography-900">{b.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-typography-600">
          <Tag type={TAB_TAG[b.tab]} size="sm">
            {BUG_FINDING_STATUS_LABELS[b.status as BugFindingStatus] ?? b.status}
          </Tag>
          <Tag type="outline" size="sm">
            {en.bugHunterV2.board.v1Badge}
          </Tag>
          {b.app && <span>{b.app}</span>}
          <span>· {BUG_FINDING_SOURCE_LABELS[source as BugFindingSource] ?? source}</span>
          {b.severity && <span>· {b.severity}</span>}
          <span>· {formatDateTime(b.createdAt)}</span>
        </div>
        <p className="text-xs text-typography-500">{strings.readOnly}</p>
      </header>

      <Section title={strings.description}>
        <p className="whitespace-pre-wrap text-sm text-typography-800">
          {b.description || strings.none}
        </p>
        {b.file && <code className="text-xs text-typography-600">{b.file}</code>}
      </Section>

      {b.evidence && (
        <Section title={strings.evidence}>
          <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap rounded border border-neutral-200 bg-neutral-50 p-2 text-xs">
            {b.evidence}
          </pre>
        </Section>
      )}

      {(b.escalationQuestion || b.decisionReason || b.decisionNote || b.prUrl || b.releaseTag) && (
        <Section title={strings.outcome}>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            {b.escalationQuestion && (
              <>
                <dt className="text-typography-500">{strings.question}</dt>
                <dd className="text-typography-800">{b.escalationQuestion}</dd>
              </>
            )}
            {b.escalationAnswer && (
              <>
                <dt className="text-typography-500">{strings.answer}</dt>
                <dd className="text-typography-800">{b.escalationAnswer}</dd>
              </>
            )}
            {(b.decisionReason || b.decisionNote) && (
              <>
                <dt className="text-typography-500">{strings.decision}</dt>
                <dd className="text-typography-800">
                  {[b.decisionReason, b.decisionNote].filter(Boolean).join(": ")}
                  {b.decidedAt && ` (${formatDateTime(b.decidedAt)})`}
                </dd>
              </>
            )}
            {b.prUrl && (
              <>
                <dt className="text-typography-500">{strings.pr}</dt>
                <dd>
                  <a
                    href={b.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary-600 underline"
                  >
                    {b.prUrl}
                  </a>
                </dd>
              </>
            )}
            {b.releaseTag && (
              <>
                <dt className="text-typography-500">{strings.release}</dt>
                <dd className="text-typography-800">
                  {b.releaseTag}
                  {b.releasedAt && ` (${formatDateTime(b.releasedAt)})`}
                </dd>
              </>
            )}
          </dl>
        </Section>
      )}

      <Section title={strings.history}>
        {b.events.length === 0 ? (
          <p className="text-sm text-typography-500">{strings.noHistory}</p>
        ) : (
          <ol className="flex flex-col gap-2 border-l border-neutral-200 pl-4">
            {b.events.map((e, i) => (
              <li key={i} className="text-sm">
                <div className="text-xs text-typography-500">
                  {formatDateTime(e.at)} ·{" "}
                  {BUG_HUNT_EVENT_STAGE_LABELS[e.stage as BugHuntEventStage] ?? e.stage}
                </div>
                <div className="text-typography-800">{e.summary}</div>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
};

export default BugHunterV2V1Bug;
