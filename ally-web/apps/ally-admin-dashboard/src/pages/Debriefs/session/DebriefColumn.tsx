import React from "react";

import { formatMs, formatUsd } from "@components/ally-guide/allyGuideFormat";
import { EmptyPanel } from "@components/ally-guide/ConsoleStates";
import { en } from "@constants";
import {
  DebriefCardsData,
  DebriefReviewFlag,
  DebriefRunDetail,
  DebriefRunStep,
  ExpertComment,
  ExpertCommentDraftAnchor,
  ExpertReviewDetail,
} from "@types";

import { checkLabel, recipeLabel, sectionLabel, stepName } from "../consoleLabels";
import { Segmented } from "../consoleUi";
import { ANCHOR_ATTR, askAnchor, cardAnchor } from "../expertReviewSelection";
import { DraftChanges } from "../RunReasoning";
import { SessionLogLink } from "../SessionLogLink";
import { Line } from "./commentParts";
import { CommentPopup } from "./CommentPopup";
import { CorrectInPlace } from "./CorrectInPlace";

export type DebriefTab = "debrief" | "how" | "ask";
export const cardDomId = (section: string) => `session-card-${section}`;

interface Props {
  run: DebriefRunDetail;
  detail: ExpertReviewDetail | undefined;
  tab: DebriefTab;
  onTab: (t: DebriefTab) => void;
  flags: DebriefReviewFlag[];
  correcting: string | null;
  onCorrectDone: () => void;
  onCorrected: () => void;
  highlightSection: string | null;
  roots: ExpertComment[];
  activeId: string | null;
  onFocusThread: (id: string) => void;
  pending: ExpertCommentDraftAnchor | null;
  onPendingDone: () => void;
  onSelect?: () => void;
  canComment: boolean;
  modelLabel: (id: string) => string;
  learnerDistress: boolean;
  /** Jump to a card (Ask Ally's "About:" link). */
  onAbout?: (section: string) => void;
}

/** One debrief card: a grey tile, its kind in small capitals above. */
const Card: React.FC<{
  section: string;
  kicker: string;
  kickerClass: string;
  lit: boolean;
  flag?: DebriefReviewFlag;
  corrected?: string | null;
  children: React.ReactNode;
  after?: React.ReactNode;
}> = ({ section, kicker, kickerClass, lit, flag, corrected, children, after }) => {
  const s = en.debriefs.session;
  return (
    <>
      <div
        id={cardDomId(section)}
        data-testid="session-card-block"
        data-section={section}
        data-highlight={lit ? "true" : undefined}
        className={[
          "flex flex-col gap-2.5 rounded-sm bg-neutral-50 px-5 py-[18px]",
          flag ? "outline outline-2 outline-destructive-200" : "",
          lit ? "ring-2 ring-warning-200" : "",
        ].join(" ")}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className={`text-xs tracking-[.32px] ${kickerClass}`}>{kicker}</div>
          {flag && (
            <span className="ml-auto rounded-full bg-destructive-100 px-2 py-0.5 text-xs text-destructive-600">
              {s.flaggedTag(en.debriefs.review.reasons[flag.reason] ?? flag.reason)}
            </span>
          )}
          {!flag && corrected && (
            <span className="ml-auto rounded-full bg-success-50 px-2 py-0.5 text-xs text-success-600">
              {corrected}
            </span>
          )}
        </div>
        {children}
      </div>
      {after}
    </>
  );
};

const Quote: React.FC<{ children: React.ReactNode; turn: number }> = ({ children, turn }) => (
  <blockquote className="m-0 rounded-sm bg-white px-3.5 py-2.5 text-sm text-neutral-700">
    “{children}” <span className="text-neutral-600">· {en.debriefs.session.turn(turn)}</span>
  </blockquote>
);

const TheDebrief: React.FC<Props & { cards: DebriefCardsData }> = props => {
  const { cards, run, detail, flags, correcting, highlightSection, roots, activeId } = props;
  const s = en.debriefs.session;
  const line = (section: string, text: string | null | undefined, className?: string) =>
    text ? (
      <Line
        anchorKey={cardAnchor(section)}
        text={text}
        comments={roots.filter(r => r.anchorKind === "card" && r.section === section)}
        activeId={activeId}
        onFocusThread={props.onFocusThread}
        className={className}
      />
    ) : null;
  const flagFor = (section: string) =>
    flags.find(f => f.section === section && (f.status === "open" || f.status === "escalated"));
  const versions = (section: string) =>
    (detail?.corrections ?? []).filter(c => c.section === section && c.outcome === "corrected")
      .length;
  const correctedLabel = (section: string) => {
    const k = (detail?.corrections ?? []).filter(c => c.section === section);
    const last = k[k.length - 1];
    if (!last) return null;
    return last.outcome === "corrected"
      ? s.correctedTag(versions(section) + 1)
      : last.outcome === "removed"
        ? en.debriefs.expertReview.cards.removed
        : en.debriefs.expertReview.cards.kept;
  };
  const popupFor = (section: string) =>
    props.canComment &&
    props.pending?.anchorKind === "card" &&
    (props.pending.section === section || props.pending.section?.startsWith(`${section}.`)) ? (
      <CommentPopup runId={run.id} anchor={props.pending} onDone={props.onPendingDone} />
    ) : null;
  const lit = (section: string) => highlightSection === section;
  const editing = (section: string) => {
    const f = flagFor(section);
    return f && correcting === f.id ? f : null;
  };

  return (
    <div className="flex flex-col gap-3" data-testid="session-debrief">
      {props.learnerDistress && (
        <div role="note" className="rounded-sm bg-[#FFF2E8] px-4 py-3 text-sm text-[#8A3800]">
          <b>{s.distressTitle}</b> {s.distressBody}
        </div>
      )}
      <div
        id={cardDomId("opening")}
        className="rounded-sm bg-neutral-50 px-5 py-[18px] text-[15px] leading-relaxed"
      >
        {line("opening", cards.opening)}
        {popupFor("opening")}
      </div>
      {cards.important_moment && (
        <Card
          section="important_moment"
          kicker={s.kinds.importantMoment}
          kickerClass="text-primary-700"
          lit={lit("important_moment")}
          flag={flagFor("important_moment")}
          corrected={correctedLabel("important_moment")}
          after={popupFor("important_moment")}
        >
          <div className="text-[17px] font-semibold">
            {line("important_moment.lead", cards.important_moment.lead)}
          </div>
          <Quote turn={cards.important_moment.turn_index}>
            {line("important_moment.quote", cards.important_moment.quote)}
          </Quote>
          <p className="m-0 text-sm leading-relaxed text-neutral-700">
            {line("important_moment.body", cards.important_moment.body)}
          </p>
        </Card>
      )}
      {cards.what_worked.map((w, i) => {
        const section = `what_worked[${i}]`;
        return (
          <Card
            key={section}
            section={section}
            kicker={s.kinds.whatWorked}
            kickerClass="text-success-600"
            lit={lit(section)}
            flag={flagFor(section)}
            corrected={correctedLabel(section)}
            after={popupFor(section)}
          >
            <div className="text-base font-semibold">
              {w.skill} · {line(`${section}.lead`, w.lead)}
            </div>
            <Quote turn={w.turn_index}>{line(`${section}.quote`, w.quote)}</Quote>
            <p className="m-0 text-sm leading-relaxed text-neutral-700">
              {line(`${section}.body`, w.body)}
            </p>
          </Card>
        );
      })}
      {cards.work_on_this.map((w, i) => {
        const section = `work_on_this[${i}]`;
        const f = editing(section);
        if (f) {
          return (
            <CorrectInPlace
              key={section}
              flag={f}
              title={s.kinds.workOnThis}
              quote={{ text: w.quote, turn: w.turn_index }}
              version={versions(section) + 2}
              onSaved={props.onCorrected}
              onCancel={props.onCorrectDone}
            />
          );
        }
        return (
          <Card
            key={section}
            section={section}
            kicker={s.kinds.workOnThis}
            kickerClass="text-[#8A3800]"
            lit={lit(section)}
            flag={flagFor(section)}
            corrected={correctedLabel(section)}
            after={popupFor(section)}
          >
            <div className="text-base font-semibold">
              {w.skill} · {line(`${section}.lead`, w.lead)}
            </div>
            <Quote turn={w.turn_index}>{line(`${section}.quote`, w.quote)}</Quote>
            <p className="m-0 text-sm leading-relaxed text-neutral-700">
              {s.whyItMatters} {line(`${section}.why`, w.why)}
            </p>
            <div className="rounded-sm border border-dashed border-primary-200 px-3.5 py-2.5 text-sm">
              <b>{s.trySaying}</b> {line(`${section}.try_saying`, w.try_saying)}
            </div>
          </Card>
        );
      })}
      {/* A flag on a card other than "Work on this" is corrected in the same form. */}
      {flags
        .filter(f => correcting === f.id && !f.section.startsWith("work_on_this"))
        .map(f => (
          <CorrectInPlace
            key={f.id}
            flag={f}
            title={sectionLabel(f.section)}
            quote={null}
            version={versions(f.section) + 2}
            onSaved={props.onCorrected}
            onCancel={props.onCorrectDone}
          />
        ))}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.practise_next && (
          <div id={cardDomId("practise_next")} className="rounded-sm bg-neutral-50 px-[18px] py-4">
            <div className="text-xs tracking-[.32px] text-neutral-600">{s.kinds.practiseNext}</div>
            <div className="mt-1.5 text-[15px] font-semibold">
              {line("practise_next.skill", cards.practise_next.skill)}
            </div>
            <div className="text-sm text-neutral-700">
              {line("practise_next.reason", cards.practise_next.reason)}
            </div>
          </div>
        )}
        {cards.reflective_question && (
          <div
            id={cardDomId("reflective_question")}
            className="rounded-sm bg-neutral-50 px-[18px] py-4"
          >
            <div className="text-xs tracking-[.32px] text-neutral-600">{s.kinds.question}</div>
            <div className="mt-1.5 text-[15px]">
              {line("reflective_question", cards.reflective_question)}
            </div>
          </div>
        )}
      </div>
      {cards.progress_note && (
        <div className="rounded-sm bg-neutral-50 px-5 py-4 text-sm">
          <div className="text-xs tracking-[.32px] text-neutral-600">{s.kinds.progress}</div>
          {line("progress_note", cards.progress_note)}
        </div>
      )}
      {popupFor("practise_next")}
      {popupFor("reflective_question")}
      {popupFor("progress_note")}
    </div>
  );
};

const stepOk = (st: DebriefRunStep) => st.status === "done";

/** "How it was made": the skill estimate, then each step with its model, time and cost. */
const HowItWasMade: React.FC<Props> = ({ run, modelLabel }) => {
  const s = en.debriefs.session.how;
  const r = en.debriefs.run;
  const est = run.skillEstimate;
  return (
    <div className="flex flex-col gap-3" data-testid="session-how">
      <div className="flex flex-col gap-2.5 rounded-sm bg-neutral-50 px-5 py-4">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-semibold">{s.skillHeading}</h3>
          <span className="ml-auto text-xs text-neutral-600">{s.skillOnlyHere}</span>
        </div>
        {est?.skills.length ? (
          <>
            {est.skills.map(k => (
              <div
                key={k.skill}
                className="grid grid-cols-[minmax(140px,1fr)_minmax(0,2fr)_120px] items-center gap-3 text-sm"
                data-testid="skill-row"
              >
                <span>{k.skill}</span>
                <span className="relative h-2 bg-neutral-100">
                  <span
                    className="absolute inset-y-0 left-0 bg-primary-500"
                    style={{ width: `${Math.round((k.level ?? 0) * 100)}%` }}
                  />
                </span>
                <span className="text-[13px] text-neutral-700">
                  {k.word ?? (k.level === null ? s.didntComeUp : `${Math.round(k.level * 100)}%`)}
                </span>
              </div>
            ))}
            <div className="text-xs text-neutral-600">{s.skillFrom(est.sessions)}</div>
          </>
        ) : (
          <p className="text-sm text-neutral-600">{s.noSkill}</p>
        )}
      </div>
      <div className="overflow-hidden rounded-sm bg-neutral-50">
        <div className="border-b border-neutral-100 px-5 py-3.5 text-sm text-neutral-700">
          {[
            recipeLabel(run.recipeKey),
            run.fallbackRung === 0 ? s.asWritten : r.fallback(run.fallbackRung),
            run.releaseVersion != null ? s.release(run.releaseVersion) : null,
            r.cost(formatUsd(run.estimatedCostUsd), formatUsd(run.actualCostUsd)),
          ]
            .filter(Boolean)
            .join(" · ")}{" "}
          · <SessionLogLink sessionId={run.scenarioSessionId} />
        </div>
        <ol>
          {run.steps.map((st, i) => (
            <li
              key={i}
              className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-3 border-b border-neutral-100 px-5 py-3"
              data-testid="run-step"
            >
              <span
                aria-label={stepOk(st) ? s.stepOk : s.stepNotOk}
                className={`flex h-5 w-5 items-center justify-center rounded-full text-xs text-white ${stepOk(st) ? "bg-success-400" : "bg-[#8A3800]"}`}
              >
                {stepOk(st) ? "✓" : "!"}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold">
                  {r.stepNames[st.step] ?? stepName(st.step)}
                  {st.round ? ` · ${r.round(st.round)}` : ""}
                </div>
                <div className="text-[13px] text-neutral-600">
                  {st.output ??
                    st.note ??
                    (st.status === "skipped" ? r.skipped : st.status === "failed" ? r.failed : "")}
                </div>
                {(st.why || st.reasoning) && (
                  <details className="mt-1 text-[13px]">
                    <summary className="cursor-pointer text-primary-500">{s.reasoning}</summary>
                    {st.why && (
                      <p>
                        <span className="font-semibold">{r.why}:</span> {st.why}
                      </p>
                    )}
                    {st.inputs?.length ? (
                      <p>
                        <span className="font-semibold">{r.given}:</span> {st.inputs.join(" · ")}
                      </p>
                    ) : null}
                    {st.reasoning && (
                      <p className="italic">
                        <span className="font-semibold not-italic">{r.thinking}:</span>{" "}
                        {st.reasoning}
                      </p>
                    )}
                  </details>
                )}
              </div>
              <div className="text-right text-xs text-neutral-600">
                {st.model ? <span title={st.model}>{modelLabel(st.model)}</span> : s.code}
                <br />
                {formatMs(st.ms)}
                {st.estimatedUsd ? ` · ${formatUsd(st.estimatedUsd)}` : ""}
              </div>
            </li>
          ))}
        </ol>
      </div>
      {run.workspace?.decision && (
        <div className="rounded-sm bg-neutral-50 px-5 py-3 text-sm" data-testid="run-decision">
          <span className="font-semibold">{r.decision}:</span> {run.workspace.decision.why}
        </div>
      )}
      {run.checkFailures.length > 0 && (
        <div className="rounded-sm bg-neutral-50 px-5 py-3 text-sm">
          <p className="font-semibold">{r.checks}</p>
          <ul className="list-disc pl-5">
            {run.checkFailures.map((f, i) => (
              <li key={i}>
                {checkLabel(f.code)} · {sectionLabel(f.section)}: {f.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="rounded-sm bg-neutral-50 px-5 py-3 text-sm">
        <summary className="cursor-pointer font-semibold">{r.draftChanges}</summary>
        <div className="mt-2">
          <DraftChanges run={run} />
        </div>
      </details>
    </div>
  );
};

/**
 * Ask Ally: the learner's conversation with Ally after reading the debrief, exactly as they saw
 * it, with each reply's checks, lookups, time and cost. Read-only; Ask Ally is learner-only.
 */
const AskAlly: React.FC<Props & { onAbout: (section: string) => void }> = props => {
  const { run, modelLabel } = props;
  const s = en.debriefs.session.ask;
  const traces = run.workspace?.replyTraces ?? [];
  if (traces.length === 0) return <EmptyPanel title={s.none} message={s.noneHelp} />;
  const replaced = traces.filter(t => t.outcome === "replaced").length;
  const anyDistressKnown = traces.some(t => t.distress != null);
  const distress = traces.some(t => t.distress);
  const firstWords = traces.map(t => t.firstWordsMs).filter((x): x is number => x != null);
  const total = traces.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);
  const asked = traces.filter(t => t.question).length || traces.length;
  return (
    <div className="flex flex-col gap-3" data-testid="session-ask">
      <div
        className="flex flex-wrap gap-x-[18px] gap-y-1.5 bg-neutral-50 px-4 py-2.5 text-[13px] text-neutral-700"
        data-testid="ask-summary"
      >
        <span>{s.summary.questions(asked)}</span>
        {traces.some(t => t.outcome) && <span>{s.summary.replaced(replaced)}</span>}
        {anyDistressKnown && <span>{distress ? s.summary.distress : s.summary.noDistress}</span>}
        {firstWords.length > 0 && (
          <span>
            {s.summary.firstWords(
              formatMs(firstWords.sort((a, b) => a - b)[Math.floor(firstWords.length / 2)]),
            )}
          </span>
        )}
        <span>{s.summary.total(formatUsd(total))}</span>
      </div>
      <div className="text-xs text-neutral-600">{props.canComment ? s.help : s.helpReadOnly}</div>
      {traces.map((t, i) => {
        const when = new Date(t.at).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        });
        const section = `ask_ally[${i}]`;
        return (
          <div key={`${t.at}-${i}`} className="flex flex-col gap-2" data-testid="ask-exchange">
            <div className="self-start text-xs text-neutral-600">
              {t.section ? (
                <>
                  {s.about}{" "}
                  <button
                    type="button"
                    className="text-primary-500 underline"
                    onClick={() => props.onAbout(t.section as string)}
                  >
                    {sectionLabel(t.section)}
                  </button>{" "}
                  · {when}
                </>
              ) : (
                when
              )}
            </div>
            {t.question && (
              <div className="max-w-[85%] self-end bg-primary-50 px-3.5 py-2.5 text-sm leading-normal">
                <div className="mb-0.5 text-xs text-neutral-600">{en.debriefs.session.learner}</div>
                <span {...{ [ANCHOR_ATTR]: askAnchor(i) }}>{t.question}</span>
              </div>
            )}
            <div className="flex max-w-[85%] flex-col gap-1.5 self-start bg-neutral-50 px-3.5 py-2.5 text-sm leading-normal">
              <div className="text-xs text-neutral-600">{s.ally}</div>
              {t.reply ? (
                <div {...(t.question ? {} : { [ANCHOR_ATTR]: askAnchor(i) })}>{t.reply}</div>
              ) : (
                <div className="text-neutral-600">{s.replyNotKept}</div>
              )}
              {t.outcome === "replaced" && (t.blocked || t.failedCheck) && (
                <details className="text-[13px] text-neutral-700">
                  <summary className="cursor-pointer text-[#8A3800]">{s.whatBlocked}</summary>
                  {t.blocked && (
                    <div className="mt-1.5 bg-white px-2.5 py-2 text-neutral-600 line-through">
                      {t.blocked}
                    </div>
                  )}
                  {t.failedCheck && <div className="mt-1">{s.failedCheck(t.failedCheck)}</div>}
                </details>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start text-xs">
              {t.outcome && (
                <span
                  className={`rounded-full px-2 py-0.5 font-semibold ${t.outcome === "passed" ? "bg-success-50 text-success-600" : "bg-[#FFF2E8] text-[#8A3800]"}`}
                >
                  {s.outcome[t.outcome]}
                </span>
              )}
              {t.tools.length > 0 && (
                <span className="text-neutral-600">
                  {s.lookedUp(
                    t.tools
                      .map(
                        tool =>
                          `${en.debriefs.run.toolNames[tool.name] ?? tool.name}${tool.topic ? ` “${tool.topic}”` : ""}`,
                      )
                      .join(", "),
                  )}
                </span>
              )}
              <span className="text-neutral-600">
                {[
                  t.firstWordsMs != null ? s.firstWordsOne(formatMs(t.firstWordsMs)) : null,
                  formatUsd(t.costUsd),
                ]
                  .filter(Boolean)
                  .join(" · ")}{" "}
                · <span title={t.model}>{modelLabel(t.model)}</span>
              </span>
              {t.stoppedBy && (
                <span className="text-neutral-600">{en.debriefs.run.stoppedBy[t.stoppedBy]}</span>
              )}
            </div>
            {props.canComment &&
              props.pending?.anchorKind === "debrief" &&
              props.pending.section === section && (
                <CommentPopup runId={run.id} anchor={props.pending} onDone={props.onPendingDone} />
              )}
          </div>
        );
      })}
    </div>
  );
};

/** The right column: the debrief, how it was made, and Ask Ally, as tabs. */
export const DebriefColumn: React.FC<Props> = props => {
  const s = en.debriefs.session;
  const asks = props.run.workspace?.replyTraces?.length ?? 0;
  const cards = props.detail?.cards ?? props.run.cards;
  return (
    <section
      aria-label={s.debrief}
      className="flex min-w-0 flex-[1_1_380px] flex-col gap-3 overflow-y-auto lg:h-[78vh]"
      data-testid="session-debrief-column"
      onMouseUp={props.canComment ? props.onSelect : undefined}
    >
      <div className="self-start">
        <Segmented<DebriefTab>
          role="tablist"
          label={s.debrief}
          value={props.tab}
          onChange={props.onTab}
          items={[
            { id: "debrief", label: s.tabs.debrief },
            { id: "how", label: s.tabs.how },
            { id: "ask", label: asks ? s.tabs.askCount(asks) : s.tabs.ask },
          ]}
        />
      </div>
      {props.tab === "debrief" &&
        (cards ? (
          <TheDebrief {...props} cards={cards} />
        ) : (
          <EmptyPanel title={s.noCards} message={props.run.error ?? undefined} />
        ))}
      {props.tab === "how" && <HowItWasMade {...props} />}
      {props.tab === "ask" && (
        <AskAlly
          {...props}
          onAbout={section => {
            props.onTab("debrief");
            props.onAbout?.(section);
          }}
        />
      )}
    </section>
  );
};
