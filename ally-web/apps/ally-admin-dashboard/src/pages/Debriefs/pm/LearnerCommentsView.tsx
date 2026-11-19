import React, { useState } from "react";

import { Link } from "react-router-dom";

import { useGetDebriefLearnerCommentsQuery } from "@api";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en, ROUTES } from "@constants";
import { DebriefLearnerCommentItem } from "@types";

/** The card a comment is on, in words: `what_worked[0].body` → "What worked 1". */
export const cardLabel = (section: string | null): string => {
  const s = en.debriefs.v2.changes.learnerComments;
  if (!section) return s.whole;
  const m = /^([a-z_]+)(?:\[(\d+)\])?/.exec(section);
  if (!m) return section;
  const name = s.cards[m[1]] ?? m[1];
  return m[2] === undefined ? name : `${name} ${Number(m[2]) + 1}`;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

const Row: React.FC<{ c: DebriefLearnerCommentItem }> = ({ c }) => {
  const s = en.debriefs.v2.changes.learnerComments;
  return (
    <li
      className="flex flex-col gap-1.5 border-b border-neutral-100 px-5 py-3.5 text-sm"
      data-testid="learner-comment-row"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600">
        <span className="font-medium text-typography-900">{c.learnerName ?? s.someone}</span>
        {c.tenantName && <span>{c.tenantName}</span>}
        {c.language && <span>{c.language}</span>}
        <span>{when(c.createdAt)}</span>
        <span className="rounded-full bg-neutral-100 px-2 py-0.5">{cardLabel(c.section)}</span>
        {c.status === "resolved" && <span>{s.resolved}</span>}
      </div>
      {c.quotedText && (
        <p className="m-0 border-l-2 border-neutral-200 pl-2.5 text-[13px] text-neutral-700">
          “{c.quotedText}”
        </p>
      )}
      <p className="m-0 text-[15px] text-typography-900">{c.body}</p>
      <Link
        to={ROUTES.DEBRIEF_SESSION(c.runId)}
        className="self-start text-xs text-primary-500 underline"
        data-testid={`learner-comment-open-${c.id}`}
      >
        {s.open}
      </Link>
    </li>
  );
};

/** One page of learner comments; older pages load under it as the person asks. */
const Page: React.FC<{ before?: string; onMore: (next: string) => void; last: boolean }> = ({
  before,
  onMore,
  last,
}) => {
  const s = en.debriefs.v2.changes.learnerComments;
  const q = useGetDebriefLearnerCommentsQuery({ before });
  if (q.isLoading) return <LoadingBlock lines={3} />;
  if (q.isError || !q.data) {
    return <ErrorPanel what={s.loadFailed} error={q.error} onRetry={() => void q.refetch()} />;
  }
  const { items, next } = q.data;
  return (
    <>
      {items.map(c => (
        <Row key={c.id} c={c} />
      ))}
      {last && next && (
        <li className="px-5 py-3">
          <button
            type="button"
            onClick={() => onMore(next)}
            className="text-sm text-primary-500 underline"
            data-testid="learner-comments-more"
          >
            {s.more}
          </button>
        </li>
      )}
    </>
  );
};

/**
 * Changes › Learner comments: what learners wrote about their own debrief by selecting words in it,
 * newest first, each with the words, the card, who and where, and a link to the debrief.
 */
export const LearnerCommentsView: React.FC = () => {
  const s = en.debriefs.v2.changes.learnerComments;
  const [cursors, setCursors] = useState<string[]>([]);
  const first = useGetDebriefLearnerCommentsQuery({});
  const empty = first.data && first.data.items.length === 0;
  return (
    <div
      className="flex max-w-[960px] flex-col gap-4 px-8 py-7"
      data-testid="learner-comments-view"
    >
      <p className="m-0 max-w-3xl text-sm text-neutral-600">{s.intro}</p>
      {empty ? (
        <p className="text-sm text-neutral-600" data-testid="learner-comments-none">
          {s.none}
        </p>
      ) : (
        <ul className="m-0 list-none rounded-sm bg-neutral-50 p-0">
          <Page onMore={next => setCursors(c => [...c, next])} last={cursors.length === 0} />
          {cursors.map((before, i) => (
            <Page
              key={before}
              before={before}
              onMore={next => setCursors(c => [...c, next])}
              last={i === cursors.length - 1}
            />
          ))}
        </ul>
      )}
    </div>
  );
};
