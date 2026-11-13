import React from "react";

import { formatMs, formatUsd } from "@components/ally-guide/allyGuideFormat";
import { EmptyPanel } from "@components/ally-guide/ConsoleStates";
import { en } from "@constants";
import {
  DebriefCardCorrection,
  DebriefCardsData,
  DebriefSessionFlag,
  DebriefSessionView,
  ExpertComment,
  ExpertCommentDraftAnchor,
} from "@types";

import { checkLabel, sectionLabel } from "../consoleLabels";
import { Segmented } from "../consoleUi";
import { ANCHOR_ATTR, askAnchor, cardAnchor } from "../expertReviewSelection";
import { Line } from "./commentParts";
import { CommentPopup } from "./CommentPopup";
import { CorrectInPlace } from "./CorrectInPlace";

export type DebriefTab = "debrief" | "ask";
export const cardDomId = (section: string) => `session-card-${section}`;

/** What is being corrected in place: a flagged card, or a card of a held debrief. */
export interface Correcting {
  flagId: string | null;
  section: string;
}

interface Props {
  view: DebriefSessionView;
  tab: DebriefTab;
  onTab: (t: DebriefTab) => void;
  correcting: Correcting | null;
  onCorrectDone: () => void;
  onCorrected: () => void;
  highlightSection: string | null;
  roots: ExpertComment[];
  activeId: string | null;
  onFocusThread: (id: string) => void;
  pending: ExpertCommentDraftAnchor | null;
  onPendingDone: () => void;
  onSelect?: () => void;
  modelLabel: (id: string) => string;
  /** Jump to a card (Ask Ally's "About:" link). */
  onAbout: (section: string) => void;
}

/** The words of a card a reviewer may rewrite, read from the card itself. */
export const cardFields = (
  cards: DebriefCardsData,
  section: string,
): { fields: DebriefCardCorrection; quote: { text: string; turn: number } | null } | null => {
  if (section === "important_moment" && cards.important_moment) {
    const c = cards.important_moment;
    return {
      fields: { lead: c.lead, body: c.body },
      quote: { text: c.quote, turn: c.turn_index },
    };
  }
  const m = /^(what_worked|work_on_this)\[(\d+)\]$/.exec(section);
  if (m && m[1] === "what_worked") {
    const c = cards.what_worked[Number(m[2])];
    return c
      ? { fields: { lead: c.lead, body: c.body }, quote: { text: c.quote, turn: c.turn_index } }
      : null;
  }
  if (m) {
    const c = cards.work_on_this[Number(m[2])];
    return c
      ? {
          fields: { lead: c.lead, why: c.why, try_saying: c.try_saying },
          quote: { text: c.quote, turn: c.turn_index },
        }
      : null;
  }
  if (section === "practise_next" && cards.practise_next) {
    return { fields: { reason: cards.practise_next.reason }, quote: null };
  }
  return null;
};

/**
 * An open learner flag on a card: the reason and, when the learner wrote one, their note — one
 * line, truncated; the whole note on hover or keyboard focus.
 */
const FlagTag: React.FC<{ flag: DebriefSessionFlag }> = ({ flag }) => {
  const s = en.debriefs.session;
  const text = s.flaggedTag(en.debriefs.review.reasons[flag.reason] ?? flag.reason, flag.note);
  return (
    <span
      tabIndex={0}
      aria-label={text}
      data-testid="card-flag-tag"
      className="group relative ml-auto min-w-0 max-w-full rounded-full bg-destructive-100 px-2 py-0.5 text-xs text-destructive-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-destructive-600"
    >
      <span aria-hidden="true" className="block truncate">
        {text}
      </span>
      {flag.note && (
        <span
          role="tooltip"
          aria-hidden="true"
          data-testid="card-flag-note-full"
          className="invisible absolute right-0 top-full z-20 mt-1 w-72 max-w-[80vw] whitespace-normal rounded-sm bg-neutral-900 px-3 py-2 text-xs text-white shadow-lg group-hover:visible group-focus:visible"
        >
          {text}
        </span>
      )}
    </span>
  );
};

/** One debrief card: a grey tile, its kind in small capitals above. */
const Card: React.FC<{
  section: string;
  kicker: string;
  kickerClass: string;
  lit: boolean;
  flag?: DebriefSessionFlag;
  /** A decided flag: the line the learner reads under this card (PRD §6.7). */
  outcome?: string | null;
  children: React.ReactNode;
  after?: React.ReactNode;
}> = ({ section, kicker, kickerClass, lit, flag, outcome, children, after }) => (
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
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className={`text-xs tracking-[.32px] ${kickerClass}`}>{kicker}</div>
        {flag && <FlagTag flag={flag} />}
      </div>
      {children}
      {!flag && outcome && (
        <p data-testid="card-learner-outcome" className="m-0 text-xs text-neutral-700">
          {outcome}
        </p>
      )}
    </div>
    {after}
  </>
);

const Quote: React.FC<{ children: React.ReactNode; turn: number }> = ({ children, turn }) => (
  <blockquote className="m-0 rounded-sm bg-white px-3.5 py-2.5 text-sm text-neutral-700">
    “{children}” <span className="text-neutral-600">· {en.debriefs.session.turn(turn)}</span>
  </blockquote>
);

const TheDebrief: React.FC<Props & { cards: DebriefCardsData }> = props => {
  const { cards, view, correcting, highlightSection, roots, activeId } = props;
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
    view.flags.find(
      f => f.section === section && (f.status === "open" || f.status === "escalated"),
    );
  /** What the learner reads under the card once their flag was decided (the learner app's words). */
  const outcomeLine = (section: string) => {
    const k = view.corrections.filter(c => c.section === section);
    const last = k[k.length - 1];
    if (!last) return null;
    const o = s.learnerOutcome;
    if (last.outcome === "corrected") {
      const date = last.at
        ? new Date(last.at).toLocaleDateString("en", { dateStyle: "medium" })
        : "";
      return o.corrected(date, last.note);
    }
    return last.outcome === "removed" ? o.removed : o.kept(last.note);
  };
  const popupFor = (section: string) =>
    view.can.comment &&
    props.pending?.anchorKind === "card" &&
    (props.pending.section === section || props.pending.section?.startsWith(`${section}.`)) ? (
      <CommentPopup runId={view.run.id} anchor={props.pending} onDone={props.onPendingDone} />
    ) : null;
  const lit = (section: string) => highlightSection === section;
  const editor = (section: string, title: string) => {
    if (!correcting || correcting.section !== section) return null;
    const flag = correcting.flagId ? view.flags.find(f => f.id === correcting.flagId) : undefined;
    const fromCard = cardFields(cards, section);
    const fields = flag?.card ?? fromCard?.fields;
    if (!fields) return null;
    return (
      <CorrectInPlace
        key={`edit-${section}`}
        runId={view.run.id}
        section={section}
        flagId={correcting.flagId}
        fields={fields}
        title={title}
        quote={fromCard?.quote ?? null}
        version={view.cardVersion + 1}
        onSaved={props.onCorrected}
        onCancel={props.onCorrectDone}
      />
    );
  };

  return (
    <div className="flex flex-col gap-3" data-testid="session-debrief">
      {view.learnerDistress.present && (
        <div
          role="note"
          className="rounded-sm bg-[#FFF2E8] px-4 py-3 text-sm text-[#8A3800]"
          data-testid="distress-note"
        >
          <b>{s.distressTitle}</b>{" "}
          {view.learnerDistress.inAskAlly && !view.learnerDistress.inSession
            ? s.distressAskAlly
            : s.distressBody}
        </div>
      )}
      <div
        id={cardDomId("opening")}
        className="rounded-sm bg-neutral-50 px-5 py-[18px] text-[15px] leading-relaxed"
      >
        {line("opening", cards.opening)}
        {popupFor("opening")}
      </div>
      {cards.important_moment &&
        (editor("important_moment", s.kinds.importantMoment) ?? (
          <Card
            section="important_moment"
            kicker={s.kinds.importantMoment}
            kickerClass="text-primary-700"
            lit={lit("important_moment")}
            flag={flagFor("important_moment")}
            outcome={outcomeLine("important_moment")}
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
        ))}
      {cards.what_worked.map((w, i) => {
        const section = `what_worked[${i}]`;
        return (
          editor(section, s.kinds.whatWorked) ?? (
            <Card
              key={section}
              section={section}
              kicker={s.kinds.whatWorked}
              kickerClass="text-success-600"
              lit={lit(section)}
              flag={flagFor(section)}
              outcome={outcomeLine(section)}
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
          )
        );
      })}
      {cards.work_on_this.map((w, i) => {
        const section = `work_on_this[${i}]`;
        return (
          editor(section, s.kinds.workOnThis) ?? (
            <Card
              key={section}
              section={section}
              kicker={s.kinds.workOnThis}
              kickerClass="text-[#8A3800]"
              lit={lit(section)}
              flag={flagFor(section)}
              outcome={outcomeLine(section)}
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
          )
        );
      })}
      {correcting?.section === "practise_next" && editor("practise_next", s.kinds.practiseNext)}
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

type Tool = { name?: string; topic?: string };

/**
 * Ask Ally: the learner's conversation with Ally after reading the debrief, exactly as they saw
 * it, with each reply's checks, lookups and cost. Read-only (Ask Ally is learner-only); people
 * with review rights can select words to comment.
 */
const AskAlly: React.FC<Props> = props => {
  const { view, modelLabel } = props;
  const s = en.debriefs.session.ask;
  const ex = view.askAlly.exchanges;
  if (ex.length === 0) return <EmptyPanel title={s.none} message={s.noneHelp} />;
  const replaced = ex.filter(t => t.check === "replaced").length;
  const firstWords = ex.map(t => t.firstWordsMs).filter((x): x is number => x != null);
  return (
    <div className="flex flex-col gap-3" data-testid="session-ask">
      <div
        className="flex flex-wrap gap-x-[18px] gap-y-1.5 bg-neutral-50 px-4 py-2.5 text-[13px] text-neutral-700"
        data-testid="ask-summary"
      >
        <span>{s.summary.questions(ex.length)}</span>
        <span>{s.summary.replaced(replaced)}</span>
        <span>{view.learnerDistress.inAskAlly ? s.summary.distress : s.summary.noDistress}</span>
        {firstWords.length > 0 && (
          <span>
            {s.summary.firstWords(
              formatMs([...firstWords].sort((a, b) => a - b)[Math.floor(firstWords.length / 2)]),
            )}
          </span>
        )}
        {view.askAlly.totalCostUsd != null && (
          <span>{s.summary.total(formatUsd(view.askAlly.totalCostUsd))}</span>
        )}
      </div>
      <div className="text-xs text-neutral-600">{view.can.comment ? s.help : s.helpReadOnly}</div>
      {ex.map((t, i) => {
        const when = new Date(t.askedAt).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        });
        const tools = (t.tools as Tool[]).filter(x => x && typeof x === "object" && x.name);
        return (
          <div key={`${t.askedAt}-${i}`} className="flex flex-col gap-2" data-testid="ask-exchange">
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
            <div className="max-w-[85%] self-end bg-primary-50 px-3.5 py-2.5 text-sm leading-normal">
              <div className="mb-0.5 text-xs text-neutral-600">{en.debriefs.session.learner}</div>
              <span {...{ [ANCHOR_ATTR]: askAnchor(i) }}>{t.question}</span>
            </div>
            <div className="flex max-w-[85%] flex-col gap-1.5 self-start bg-neutral-50 px-3.5 py-2.5 text-sm leading-normal">
              <div className="text-xs text-neutral-600">{s.ally}</div>
              {t.reply ? <div>{t.reply}</div> : <div className="text-neutral-600">{s.noReply}</div>}
              {t.check === "replaced" && t.replacedReply && (
                <details className="text-[13px] text-neutral-700">
                  <summary className="cursor-pointer text-[#8A3800]">{s.whatBlocked}</summary>
                  <div className="mt-1.5 bg-white px-2.5 py-2 text-neutral-600 line-through">
                    {t.replacedReply.reply}
                  </div>
                  {t.replacedReply.fails.length > 0 && (
                    <div className="mt-1">
                      {s.failedCheck(t.replacedReply.fails.map(checkLabel).join(", "))}
                    </div>
                  )}
                </details>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start text-xs">
              {t.check !== "no_reply" && (
                <span
                  className={`rounded-full px-2 py-0.5 font-semibold ${t.check === "passed" ? "bg-success-50 text-success-600" : "bg-[#FFF2E8] text-[#8A3800]"}`}
                >
                  {s.outcome[t.check]}
                </span>
              )}
              {tools.length > 0 && (
                <span className="text-neutral-600">
                  {s.lookedUp(
                    tools
                      .map(
                        tool =>
                          `${en.debriefs.run.toolNames[tool.name as string] ?? tool.name}${tool.topic ? ` “${tool.topic}”` : ""}`,
                      )
                      .join(", "),
                  )}
                </span>
              )}
              <span className="text-neutral-600">
                {[
                  t.firstWordsMs != null ? s.firstWordsOne(formatMs(t.firstWordsMs)) : null,
                  t.costUsd != null ? formatUsd(t.costUsd) : null,
                  t.model ? modelLabel(t.model) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            {view.can.comment &&
              props.pending?.anchorKind === "debrief" &&
              props.pending.section === `ask_ally[${i}]` && (
                <CommentPopup
                  runId={view.run.id}
                  anchor={props.pending}
                  onDone={props.onPendingDone}
                />
              )}
          </div>
        );
      })}
    </div>
  );
};

/** The right column: the debrief and Ask Ally, as tabs (the run's working is on Agent logs). */
export const DebriefColumn: React.FC<Props> = props => {
  const s = en.debriefs.session;
  const asks = props.view.askAlly.exchanges.length;
  const cards = props.view.cards;
  return (
    <section
      aria-label={s.debrief}
      className="flex min-w-0 flex-[1_1_380px] flex-col gap-3 overflow-y-auto lg:h-[78vh]"
      data-testid="session-debrief-column"
      onMouseUp={props.view.can.comment ? props.onSelect : undefined}
    >
      <div className="self-start">
        <Segmented<DebriefTab>
          role="tablist"
          label={s.debrief}
          value={props.tab}
          onChange={props.onTab}
          items={[
            { id: "debrief", label: s.tabs.debrief },
            { id: "ask", label: asks ? s.tabs.askCount(asks) : s.tabs.ask },
          ]}
        />
      </div>
      {props.tab === "debrief" &&
        (cards ? (
          <TheDebrief {...props} cards={cards} />
        ) : (
          <EmptyPanel title={s.noCards} message={props.view.howItWasMade.error ?? undefined} />
        ))}
      {props.tab === "ask" && <AskAlly {...props} />}
    </section>
  );
};
