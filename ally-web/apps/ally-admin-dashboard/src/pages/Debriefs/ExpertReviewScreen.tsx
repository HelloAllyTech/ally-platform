import React, { useMemo, useState } from "react";

import { toast } from "sonner";

import { Button, Checkbox, Select, SelectItem, TextArea } from "@ally-ui-mono/ui-shared";
import {
  useAddExpertCommentMutation,
  useDeleteExpertCommentMutation,
  useEditExpertCommentMutation,
  useGetExpertReviewQuery,
  useGetMyExpertCommentsQuery,
  useMarkStillHappeningMutation,
  useSetExpertCommentStatusMutation,
  useSetExpertVerdictMutation,
} from "@api";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import {
  ExpertComment,
  ExpertCommentDraftAnchor,
  ExpertCommentTag,
  ExpertReviewDetail,
  ExpertVerdict,
} from "@types";
import { getErrorMessage } from "@utils";

import { formatWhen, score } from "./consoleTable";
import {
  ANCHOR_ATTR,
  cardAnchor,
  segmentText,
  selectionToAnchor,
  turnAnchor,
} from "./expertReviewSelection";
import { RunPanel, SessionLogLink } from "./RunPanel";

const s = () => en.debriefs.expertReview;

const TAGS: ExpertCommentTag[] = [
  "missed_moment",
  "wrong_or_unsupported",
  "tone",
  "advice_doesnt_fit",
  "protocol",
  "language",
  "too_long_or_unclear",
  "good_keep_this",
];

export const ideaStatusLabel = (idea: ExpertComment["idea"]): string =>
  idea ? (s().idea.status[idea.status ?? ""] ?? s().idea.none) : s().idea.none;

const scrollToTurn = (turnIndex: number) => {
  document.getElementById(`expert-turn-${turnIndex}`)?.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
};

/** One selectable line: its text with each comment's span highlighted. */
const Line: React.FC<{
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

interface PaneProps {
  detail: ExpertReviewDetail;
  roots: ExpertComment[];
  activeId: string | null;
  onFocusThread: (id: string) => void;
}

const TranscriptPane: React.FC<PaneProps> = ({ detail, roots, activeId, onFocusThread }) => (
  <ol className="flex flex-col gap-3" data-testid="expert-transcript">
    {detail.transcript.map(turn => (
      <li
        key={turn.turnIndex}
        id={`expert-turn-${turn.turnIndex}`}
        className={[
          "flex flex-col gap-1 rounded border p-3 text-sm",
          turn.riskCue ? "border-warning-500" : "border-border-light",
          turn.speaker === "client" ? "bg-neutral-50" : "",
        ].join(" ")}
        data-testid="expert-turn"
      >
        <div className="flex flex-wrap items-center gap-2 text-xs text-typography-700">
          <span className="font-mono">{s().turn(turn.turnIndex)}</span>
          <span className="font-medium">
            {turn.speaker === "client" ? s().client : s().learner}
          </span>
          {turn.riskCue && <Pill tone="warning">{s().riskCue(turn.riskCue.category)}</Pill>}
          {turn.gap && <Pill tone="neutral">{s().gap}</Pill>}
        </div>
        <Line
          anchorKey={turnAnchor(turn.turnIndex)}
          text={turn.text}
          comments={roots.filter(
            c => c.anchorKind === "transcript" && c.turnIndex === turn.turnIndex,
          )}
          activeId={activeId}
          onFocusThread={onFocusThread}
          className="whitespace-pre-wrap text-typography-900"
        />
      </li>
    ))}
  </ol>
);

const Card: React.FC<{ title: string; children: React.ReactNode; badge?: React.ReactNode }> = ({
  title,
  children,
  badge,
}) => (
  <div
    className="flex flex-col gap-1 rounded border border-border-light p-3"
    data-testid="expert-card"
  >
    <div className="flex flex-wrap items-center gap-2">
      <p className="font-semibold">{title}</p>
      {badge}
    </div>
    {children}
  </div>
);

const CardsPane: React.FC<PaneProps> = ({ detail, roots, activeId, onFocusThread }) => {
  const c = detail.cards;
  const t = s().cards;
  const line = (section: string, text: string | null | undefined, className?: string) =>
    text ? (
      <Line
        anchorKey={cardAnchor(section)}
        text={text}
        comments={roots.filter(r => r.anchorKind === "card" && r.section === section)}
        activeId={activeId}
        onFocusThread={onFocusThread}
        className={className}
      />
    ) : null;
  const correction = (section: string) => {
    const k = detail.corrections.find(x => x.section === section);
    if (!k) return null;
    const label =
      k.outcome === "removed" ? t.removed : k.outcome === "corrected" ? t.corrected : t.kept;
    return (
      <Pill tone={k.outcome === "removed" ? "warning" : "info"} title={k.note ?? undefined}>
        {label}
      </Pill>
    );
  };
  const quote = (section: string, q: string, turnIndex: number) => (
    <p className="italic">
      “{line(section, q)}”{" "}
      <button
        type="button"
        className="not-italic text-primary-600 underline"
        onClick={() => scrollToTurn(turnIndex)}
      >
        {s().goToTurn(turnIndex)}
      </button>
    </p>
  );
  return (
    <div className="flex flex-col gap-3 text-sm text-typography-900" data-testid="expert-cards">
      <Card title={t.opening}>
        <p>{line("opening", c.opening)}</p>
      </Card>
      {c.important_moment && (
        <Card title={t.importantMoment} badge={correction("important_moment")}>
          <p>{line("important_moment.lead", c.important_moment.lead)}</p>
          {quote("important_moment.quote", c.important_moment.quote, c.important_moment.turn_index)}
          <p>{line("important_moment.body", c.important_moment.body)}</p>
        </Card>
      )}
      {c.what_worked.map((w, i) => (
        <Card
          key={`w${i}`}
          title={`${t.whatWorked} · ${w.skill}`}
          badge={correction(`what_worked[${i}]`)}
        >
          <p>{line(`what_worked[${i}].lead`, w.lead)}</p>
          {quote(`what_worked[${i}].quote`, w.quote, w.turn_index)}
          <p>{line(`what_worked[${i}].body`, w.body)}</p>
        </Card>
      ))}
      {c.work_on_this.map((w, i) => (
        <Card
          key={`o${i}`}
          title={`${t.workOnThis} · ${w.skill}`}
          badge={correction(`work_on_this[${i}]`)}
        >
          <p>{line(`work_on_this[${i}].lead`, w.lead)}</p>
          {quote(`work_on_this[${i}].quote`, w.quote, w.turn_index)}
          <p>{line(`work_on_this[${i}].why`, w.why)}</p>
          <p>
            <span className="font-semibold">{t.trySaying}:</span> “
            {line(`work_on_this[${i}].try_saying`, w.try_saying)}”
          </p>
        </Card>
      ))}
      {c.practise_next && (
        <Card title={t.practiseNext} badge={correction("practise_next")}>
          <p>
            {line("practise_next.skill", c.practise_next.skill)}.{" "}
            {line("practise_next.reason", c.practise_next.reason)}
          </p>
        </Card>
      )}
      {c.progress_note && (
        <Card title={t.progress}>
          <p>{line("progress_note", c.progress_note)}</p>
        </Card>
      )}
      {c.reflective_question && (
        <Card title={t.question}>
          <p>{line("reflective_question", c.reflective_question)}</p>
        </Card>
      )}
    </div>
  );
};

const TagSelect: React.FC<{
  id: string;
  value: ExpertCommentTag | "";
  onChange: (v: ExpertCommentTag | "") => void;
}> = ({ id, value, onChange }) => (
  <Select
    id={id}
    labelText={s().composer.tag}
    value={value}
    onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
      onChange(e.target.value as ExpertCommentTag | "")
    }
  >
    <SelectItem value="" text={s().composer.noTag} />
    {TAGS.map(tag => (
      <SelectItem key={tag} value={tag} text={s().tags[tag]} />
    ))}
  </Select>
);

/** Free text first, an optional tag second (spec B2). */
const Composer: React.FC<{
  runId: string;
  anchor: ExpertCommentDraftAnchor;
  onDone: () => void;
}> = ({ runId, anchor, onDone }) => {
  const [body, setBody] = useState("");
  const [tag, setTag] = useState<ExpertCommentTag | "">("");
  const [add, { isLoading }] = useAddExpertCommentMutation();
  const save = async () => {
    try {
      await add({ runId, comment: { ...anchor, body: body.trim(), tag: tag || null } }).unwrap();
      toast.success(s().composer.saved);
      onDone();
    } catch (e) {
      toast.error(getErrorMessage(e, s().composer.failed));
    }
  };
  return (
    <section
      className="flex flex-col gap-2 rounded border border-primary-600 p-3"
      data-testid="expert-composer"
    >
      <h3 className="text-base font-medium text-typography-900">{s().composer.heading}</h3>
      <p className="text-sm text-typography-700">
        {anchor.quotedText ? (
          <>
            {s().composer.onQuote} <span className="italic">“{anchor.quotedText}”</span>
          </>
        ) : (
          s().composer.general
        )}
      </p>
      <TextArea
        id="expert-comment-body"
        labelText={s().composer.heading}
        hideLabel
        value={body}
        placeholder={s().composer.placeholder}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value)}
        rows={3}
      />
      <TagSelect id="expert-comment-tag" value={tag} onChange={setTag} />
      <div className="flex gap-2">
        <Button size="sm" disabled={!body.trim() || isLoading} onClick={() => void save()}>
          {s().composer.save}
        </Button>
        <Button size="sm" kind="ghost" onClick={onDone}>
          {s().composer.cancel}
        </Button>
      </div>
    </section>
  );
};

const anchorLabel = (c: ExpertComment) =>
  c.anchorKind === "transcript"
    ? s().threads.onTurn(c.turnIndex ?? 0)
    : c.anchorKind === "card"
      ? s().threads.onCard
      : s().threads.whole;

const Thread: React.FC<{
  root: ExpertComment;
  replies: ExpertComment[];
  runId: string;
  active: boolean;
  onFocus: () => void;
}> = ({ root, replies, runId, active, onFocus }) => {
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
      {c.mine && editing !== c.id && (
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
const VerdictPanel: React.FC<{ detail: ExpertReviewDetail }> = ({ detail }) => {
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

const FlagsPanel: React.FC<{ detail: ExpertReviewDetail }> = ({ detail }) => {
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
                {flag.section} · {f.outcome(en.debriefs.status[flag.status] ?? flag.status)}
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

/** The review screen: roleplay left, debrief right, verdict and threads alongside. */
export const ExpertReviewScreen: React.FC<{ runId: string; onBack: () => void }> = ({
  runId,
  onBack,
}) => {
  const review = useGetExpertReviewQuery(runId, { refetchOnMountOrArgChange: true });
  const [pending, setPending] = useState<ExpertCommentDraftAnchor | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const comments = review.data?.comments;
  const { roots, repliesByRoot } = useMemo(() => {
    const all = comments ?? [];
    const byRoot = new Map<string, ExpertComment[]>();
    for (const c of all) {
      if (c.parentId) byRoot.set(c.parentId, [...(byRoot.get(c.parentId) ?? []), c]);
    }
    return { roots: all.filter(c => !c.parentId), repliesByRoot: byRoot };
  }, [comments]);

  const header = (
    <Button kind="ghost" size="sm" onClick={onBack}>
      ← {s().back}
    </Button>
  );
  if (review.isError) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <ErrorPanel
          what={en.debriefs.run.loadFailed}
          error={review.error}
          onRetry={() => void review.refetch()}
        />
      </div>
    );
  }
  if (!review.data) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <LoadingBlock lines={10} />
      </div>
    );
  }
  const d = review.data;
  const onSelect = () => {
    const anchor = selectionToAnchor(window.getSelection());
    if (anchor) setPending(anchor);
  };
  const focusThread = (id: string) => {
    setActiveId(id);
    const root = roots.find(r => r.id === id);
    if (root?.status === "resolved") setShowResolved(true);
    document.getElementById(`expert-thread-${id}`)?.scrollIntoView({ block: "nearest" });
  };
  const visibleRoots = roots.filter(r => showResolved || r.status === "open");
  const highlighted = roots.filter(r => showResolved || r.status === "open");

  return (
    <div className="flex flex-col gap-4" data-testid="expert-review-screen">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {header}
        <span>{d.run.tenantName ?? "—"}</span>
        <span>· {d.run.language ?? "—"}</span>
        <span>· {s().sessionTypes[d.run.sessionType ?? ""] ?? d.run.sessionType ?? "—"}</span>
        <span>· {formatWhen(d.run.createdAt)}</span>
        <Pill tone={d.run.mode === "live" ? "info" : "neutral"}>
          {en.debriefs.mode[d.run.mode]}
        </Pill>
        {d.run.hasRiskCue && <Pill tone="warning">{s().reasons.risk_cue}</Pill>}
        <SessionLogLink sessionId={d.run.sessionId} />
        <Button kind="ghost" size="sm" onClick={() => setReasoningOpen(true)}>
          {s().howItWasMade}
        </Button>
      </div>
      <p className="text-sm text-typography-700">{s().selectHint}</p>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_340px]">
        <section className="flex min-w-0 flex-col gap-2" onMouseUp={onSelect}>
          <h3 className="text-xl font-normal text-typography-900">{s().transcriptHeading}</h3>
          <TranscriptPane
            detail={d}
            roots={highlighted}
            activeId={activeId}
            onFocusThread={focusThread}
          />
        </section>
        <section className="flex min-w-0 flex-col gap-2" onMouseUp={onSelect}>
          <h3 className="text-xl font-normal text-typography-900">{s().cardsHeading}</h3>
          <CardsPane
            detail={d}
            roots={highlighted}
            activeId={activeId}
            onFocusThread={focusThread}
          />
        </section>
        <aside className="flex min-w-0 flex-col gap-6">
          <VerdictPanel key={d.myReview?.updatedAt ?? "new"} detail={d} />
          {pending ? (
            <Composer runId={runId} anchor={pending} onDone={() => setPending(null)} />
          ) : (
            <Button kind="tertiary" size="sm" onClick={() => setPending({ anchorKind: "debrief" })}>
              {s().composer.general}
            </Button>
          )}
          <section className="flex flex-col gap-2" data-testid="expert-threads">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-medium text-typography-900">{s().threads.heading}</h3>
              <Checkbox
                id="expert-show-resolved"
                labelText={s().threads.showResolved}
                checked={showResolved}
                onChange={(_e: unknown, { checked }: { checked: boolean }) =>
                  setShowResolved(checked)
                }
              />
            </div>
            {visibleRoots.length === 0 ? (
              <EmptyPanel title={s().threads.empty} />
            ) : (
              <ul className="flex flex-col gap-3">
                {visibleRoots.map(root => (
                  <Thread
                    key={root.id}
                    root={root}
                    replies={repliesByRoot.get(root.id) ?? []}
                    runId={runId}
                    active={activeId === root.id}
                    onFocus={() => setActiveId(root.id)}
                  />
                ))}
              </ul>
            )}
          </section>
          <FlagsPanel detail={d} />
          <MyComments currentRunId={runId} />
        </aside>
      </div>
      <RunPanel runId={reasoningOpen ? runId : null} onClose={() => setReasoningOpen(false)} />
    </div>
  );
};
