import React, { useState } from "react";

import { toast } from "sonner";

import { Button, Checkbox, TextArea } from "@ally-ui-mono/ui-shared";
import {
  useAddExpertCommentMutation,
  useDeleteExpertCommentMutation,
  useEditExpertCommentMutation,
  useGetMyExpertCommentsQuery,
  useMarkStillHappeningMutation,
  useSetExpertCommentStatusMutation,
  useSetExpertVerdictMutation,
} from "@api";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { ExpertComment, ExpertCommentTag, ExpertReviewDetail, ExpertVerdict } from "@types";
import { getErrorMessage } from "@utils";

import { sectionLabel } from "../consoleLabels";
import { formatWhen, score } from "../consoleTable";
import { ANCHOR_ATTR, segmentText } from "../expertReviewSelection";

/**
 * The comment model from expert review (debrief orchestrator spec Part B), used on the session
 * page: highlighted lines, threads, the verdict, learners' flags and "what happened to my comment".
 */
const s = () => en.debriefs.expertReview;

/** The failure types the select-to-comment pop-up offers (build notes item 19). */
export const COMMENT_TAGS: ExpertCommentTag[] = [
  "missed_moment",
  "wrong_or_unsupported",
  "tone",
  "advice_doesnt_fit",
  "good_keep_this",
];

export const ideaStatusLabel = (idea: ExpertComment["idea"]): string =>
  idea ? (s().idea.status[idea.status ?? ""] ?? s().idea.none) : s().idea.none;

/** One selectable line: its text with each comment's span highlighted. */
export const Line: React.FC<{
  anchorKey: string;
  text: string;
  comments: ExpertComment[];
  activeId: string | null;
  onFocusThread: (id: string) => void;
  className?: string;
}> = ({ anchorKey, text, comments, activeId, onFocusThread, className }) => (
  <span {...{ [ANCHOR_ATTR]: anchorKey }} className={className}>
    {segmentText(text, comments).map((seg, i) =>
      seg.commentId ? (
        <mark
          key={i}
          role="button"
          tabIndex={0}
          data-testid="comment-highlight"
          onClick={() => onFocusThread(seg.commentId as string)}
          onKeyDown={e => {
            if (e.key === "Enter") onFocusThread(seg.commentId as string);
          }}
          className={[
            "cursor-pointer rounded-sm",
            seg.resolved ? "bg-neutral-100" : "bg-warning-50",
            activeId === seg.commentId ? "outline outline-2 outline-primary-600" : "",
          ].join(" ")}
        >
          {seg.text}
        </mark>
      ) : (
        <React.Fragment key={i}>{seg.text}</React.Fragment>
      ),
    )}
  </span>
);

const anchorLabel = (c: ExpertComment) =>
  c.anchorKind === "transcript"
    ? s().threads.onTurn(c.turnIndex ?? 0)
    : c.anchorKind === "card"
      ? s().threads.onCard
      : s().threads.whole;

export const Thread: React.FC<{
  root: ExpertComment;
  replies: ExpertComment[];
  runId: string;
  active: boolean;
  onFocus: () => void;
  /** Review rights: reply, edit, delete, resolve. Without them a thread is read-only. */
  canAct: boolean;
}> = ({ root, replies, runId, active, onFocus, canAct }) => {
  const t = s().threads;
  const [reply, setReply] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [add, adding] = useAddExpertCommentMutation();
  const [edit] = useEditExpertCommentMutation();
  const [remove, removing] = useDeleteExpertCommentMutation();
  const [setStatus, statusing] = useSetExpertCommentStatusMutation();
  const run = async (p: Promise<unknown>, failed: string) => {
    try {
      await p;
    } catch (e) {
      toast.error(getErrorMessage(e, failed));
    }
  };
  const body = (c: ExpertComment) => (
    <div key={c.id} className="flex flex-col gap-1" data-testid="expert-comment">
      <div className="flex flex-wrap items-center gap-2 text-xs text-typography-700">
        <span className="font-medium">{c.mine ? t.you : (c.reviewer.name ?? t.someone)}</span>
        <span>{formatWhen(c.createdAt)}</span>
        {c.tag && (
          <Pill tone={c.tag === "good_keep_this" ? "success" : "info"}>{s().tags[c.tag]}</Pill>
        )}
      </div>
      {editing === c.id ? (
        <div className="flex flex-col gap-1">
          <TextArea
            id={`edit-${c.id}`}
            labelText={t.edit}
            hideLabel
            value={editText}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditText(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!editText.trim()}
              onClick={() =>
                void run(
                  edit({ id: c.id, body: editText.trim() })
                    .unwrap()
                    .then(() => setEditing(null)),
                  t.actionFailed,
                )
              }
            >
              {t.save}
            </Button>
            <Button size="sm" kind="ghost" onClick={() => setEditing(null)}>
              {s().composer.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-typography-900">{c.body}</p>
      )}
      {canAct && c.mine && editing !== c.id && (
        <div className="flex gap-2">
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              setEditing(c.id);
              setEditText(c.body);
            }}
          >
            {t.edit}
          </Button>
          {!c.idea && (
            <Button size="sm" kind="ghost" onClick={() => setConfirmDelete(c.id)}>
              {t.delete}
            </Button>
          )}
        </div>
      )}
    </div>
  );
  return (
    <li
      id={`expert-thread-${root.id}`}
      className={[
        "flex flex-col gap-2 rounded border p-3",
        active ? "border-primary-600" : "border-border-light",
        root.status === "resolved" ? "opacity-70" : "",
      ].join(" ")}
      data-testid="expert-thread"
      onClick={onFocus}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Pill tone="neutral">{anchorLabel(root)}</Pill>
        {root.status === "resolved" && <Pill tone="success">{t.resolved}</Pill>}
        {root.repeatOf && <Pill tone="warning">{t.repeatOf}</Pill>}
      </div>
      {root.quotedText && (
        <p className="border-l-2 border-border-light pl-2 text-sm italic text-typography-700">
          “{root.quotedText}”
        </p>
      )}
      {body(root)}
      {replies.map(body)}
      <p className="text-xs text-typography-700" data-testid="comment-idea">
        {s().idea.label}: {ideaStatusLabel(root.idea)}
        {root.idea?.title ? ` — ${root.idea.title}` : ""}
      </p>
      {canAct && (
        <div className="flex flex-col gap-1">
          <TextArea
            id={`reply-${root.id}`}
            labelText={s().composer.reply}
            hideLabel
            value={reply}
            placeholder={s().composer.replyPlaceholder}
            rows={1}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReply(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              kind="tertiary"
              disabled={!reply.trim() || adding.isLoading}
              onClick={() =>
                void run(
                  add({
                    runId,
                    comment: { anchorKind: root.anchorKind, body: reply.trim(), parentId: root.id },
                  })
                    .unwrap()
                    .then(() => setReply("")),
                  s().composer.failed,
                )
              }
            >
              {s().composer.reply}
            </Button>
            <Button
              size="sm"
              kind="ghost"
              disabled={statusing.isLoading}
              onClick={() =>
                void run(
                  setStatus({
                    id: root.id,
                    action: root.status === "resolved" ? "reopen" : "resolve",
                  }).unwrap(),
                  t.actionFailed,
                )
              }
            >
              {root.status === "resolved" ? t.reopen : t.resolve}
            </Button>
          </div>
        </div>
      )}
      <ConfirmDialog
        isOpen={confirmDelete !== null}
        title={t.delete}
        cancelLabel={s().composer.cancel}
        confirmLabel={t.delete}
        danger
        isWorking={removing.isLoading}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() =>
          void run(
            remove(confirmDelete as string)
              .unwrap()
              .then(() => setConfirmDelete(null)),
            t.deleteFailed,
          )
        }
      >
        <p>{t.confirmDelete}</p>
      </ConfirmDialog>
    </li>
  );
};

/** Good / Needs work and the hard fails; the scores appear only once it is given (spec Q3). */
export const VerdictPanel: React.FC<{ detail: ExpertReviewDetail }> = ({ detail }) => {
  const v = s().verdict;
  const [verdict, setVerdict] = useState<ExpertVerdict | null>(detail.myReview?.verdict ?? null);
  const [fails, setFails] = useState<string[]>(detail.myReview?.hardFails ?? []);
  const [save, { isLoading }] = useSetExpertVerdictMutation();
  const submit = async () => {
    if (!verdict) return;
    try {
      await save({ runId: detail.run.id, verdict, hardFails: fails }).unwrap();
      toast.success(v.saved);
    } catch (e) {
      toast.error(getErrorMessage(e, v.failed));
    }
  };
  const toggle = (code: string, on: boolean) => {
    setFails(prev => (on ? [...new Set([...prev, code])] : prev.filter(c => c !== code)));
    if (on) setVerdict("needs_work");
  };
  return (
    <section
      className="flex flex-col gap-3 rounded border border-border-light p-3"
      data-testid="expert-verdict"
    >
      <h3 className="text-base font-medium text-typography-900">{v.heading}</h3>
      <div className="flex gap-2" role="group" aria-label={v.heading}>
        <Button
          size="sm"
          kind={verdict === "good" ? "primary" : "tertiary"}
          aria-pressed={verdict === "good"}
          disabled={fails.length > 0}
          onClick={() => setVerdict("good")}
        >
          {v.good}
        </Button>
        <Button
          size="sm"
          kind={verdict === "needs_work" ? "primary" : "tertiary"}
          aria-pressed={verdict === "needs_work"}
          onClick={() => setVerdict("needs_work")}
        >
          {v.needsWork}
        </Button>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium text-typography-900">{v.hardFails}</legend>
        <p className="text-xs text-typography-700">{v.hardFailsHelp}</p>
        {detail.hardFailCodes.map(code => (
          <Checkbox
            key={code}
            id={`hard-fail-${code}`}
            labelText={en.debriefs.hardFails[code] ?? code}
            checked={fails.includes(code)}
            onChange={(_e: unknown, { checked }: { checked: boolean }) => toggle(code, checked)}
          />
        ))}
      </fieldset>
      <Button size="sm" disabled={!verdict || isLoading} onClick={() => void submit()}>
        {detail.myReview ? v.update : v.save}
      </Button>
      {detail.myReview ? (
        <div
          className="flex flex-col gap-1 text-sm text-typography-700"
          data-testid="expert-scores"
        >
          <p>{v.judge(score(detail.judge?.overall))}</p>
          <p>{v.agentCheck(score(detail.evaluator?.overall))}</p>
          <p>{v.others(detail.otherReviews.count)}</p>
          {(detail.otherReviews.verdicts ?? []).map((o, i) => (
            <p key={i}>
              {v.otherVerdict(o.verdict === "good" ? v.good : v.needsWork, o.hardFails.length)}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-xs text-typography-700">{v.hiddenNote}</p>
      )}
    </section>
  );
};

export const FlagsPanel: React.FC<{ detail: ExpertReviewDetail }> = ({ detail }) => {
  const f = s().flags;
  return (
    <section className="flex flex-col gap-2" data-testid="expert-flags">
      <h3 className="text-base font-medium text-typography-900">{f.heading}</h3>
      {detail.flags.length === 0 ? (
        <p className="text-sm text-typography-700">{f.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {detail.flags.map(flag => (
            <li key={flag.id} className="rounded border border-border-light p-2">
              <p className="font-medium">{f.reasons[flag.reason ?? ""] ?? flag.reason}</p>
              {flag.note && <p className="italic">“{flag.note}”</p>}
              <p className="text-xs text-typography-700">
                {sectionLabel(flag.section)} ·{" "}
                {f.outcome(en.debriefs.status[flag.status] ?? flag.status)}
                {flag.resolutionNote ? ` — ${flag.resolutionNote}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

/** "What happened to my comment", with "still happening" for this debrief (spec C5). */
export const MyComments: React.FC<{ currentRunId?: string }> = ({ currentRunId }) => {
  const m = s().mine;
  const mine = useGetMyExpertCommentsQuery();
  const [mark, { isLoading }] = useMarkStillHappeningMutation();
  const items = (mine.data?.items ?? []).filter(c => c.runId !== currentRunId);
  const markHere = async (c: ExpertComment) => {
    if (!currentRunId) return;
    try {
      await mark({
        id: c.id,
        runId: currentRunId,
        comment: { anchorKind: "debrief", body: m.stillHappening, tag: c.tag },
      }).unwrap();
      toast.success(m.stillHappeningDone);
    } catch (e) {
      toast.error(getErrorMessage(e, m.stillHappeningFailed));
    }
  };
  return (
    <section className="flex flex-col gap-2" data-testid="expert-my-comments">
      <h3 className="text-base font-medium text-typography-900">{m.heading}</h3>
      <p className="text-xs text-typography-700">{m.help}</p>
      {mine.isError ? (
        <ErrorPanel what={m.loadFailed} error={mine.error} onRetry={() => void mine.refetch()} />
      ) : !mine.data ? (
        <LoadingBlock lines={2} />
      ) : items.length === 0 ? (
        <p className="text-sm text-typography-700">{m.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.slice(0, 30).map(c => (
            <li
              key={c.id}
              className="flex flex-col gap-1 rounded border border-border-light p-2 text-sm"
              data-testid="my-comment"
            >
              <p className="text-xs text-typography-700">{m.onDebrief(formatWhen(c.createdAt))}</p>
              {c.quotedText && <p className="italic text-typography-700">“{c.quotedText}”</p>}
              <p className="whitespace-pre-wrap">{c.body}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {c.tag && <Pill tone="info">{s().tags[c.tag]}</Pill>}
                <Pill tone={c.idea ? "info" : "neutral"}>{ideaStatusLabel(c.idea)}</Pill>
                {c.status === "resolved" && <Pill tone="success">{s().threads.resolved}</Pill>}
              </div>
              {currentRunId && (
                <div>
                  <Button
                    size="sm"
                    kind="tertiary"
                    disabled={isLoading}
                    onClick={() => void markHere(c)}
                  >
                    {m.stillHappening}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
