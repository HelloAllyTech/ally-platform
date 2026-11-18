import { FC, ReactNode, useCallback, useRef } from "react";

import {
  Bookmark,
  HeartHandshake,
  HelpCircle,
  MessageSquareQuote,
  Sprout,
  Star,
  Target,
  ThumbsUp,
  TrendingUp,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { DebriefCardsData, LearnerDebriefView, SupervisorDebriefFlag } from "@types";

import { CardFlag, DebriefHelpful, DebriefPulseCard } from "./DebriefCardFeedback";
import { PractiseLink, ROLEPLAYS_PATH, SupervisorFlag, SupportLines } from "./DebriefCardLinks";
import { Body, Card, Lead, Quote, ReadableItem, SKILL_WORD_ICON } from "./DebriefCardPrimitives";
import { DebriefProgressCard, parseProgressCard } from "./DebriefProgressCard";
import { ListenButton } from "./ReadAloudControls";
import { useDebriefEvent, useMarkOpened, useReadToTheEnd, useSeenOnce } from "./useReadToTheEnd";

/** What a supervisor sees besides the cards: the learner's flags and answer. */
export type SupervisorView = { flags?: SupervisorDebriefFlag[]; helpful?: boolean | null };

/** The cards "Listen all" reads, in the order they appear; removed ones never. */
export const readableSections = (view: LearnerDebriefView): string[] => {
  const cards = view.cards;
  if (!cards) return [];
  const removed = new Set(
    (view.corrections ?? []).filter(c => c.outcome === "removed").map(c => c.section),
  );
  return [
    cards.important_moment ? "important_moment" : null,
    "opening",
    ...cards.what_worked.map((_, i) => `what_worked[${i}]`),
    ...cards.work_on_this.map((_, i) => `work_on_this[${i}]`),
    cards.practise_next ? "practise_next" : null,
    cards.reflective_question ? "reflective_question" : null,
    // Last, as it sits below the debrief.
    parseProgressCard(cards.progress_card) ? "progress_card" : null,
  ].filter((x): x is string => !!x && !removed.has(x));
};

export const ReadyCards: FC<{
  cards: DebriefCardsData;
  view: LearnerDebriefView;
  sessionId: string;
  replyThread?: ReactNode;
  supervisor?: SupervisorView;
}> = ({ cards, view, sessionId, replyThread, supervisor }) => {
  const { t } = useTranslation();
  // The end of the last Work-on-this card, for DEBRIEF_READ XP.
  const readEndRef = useRef<HTMLDivElement>(null);
  useReadToTheEnd(sessionId, readEndRef, !supervisor);
  useMarkOpened(sessionId, !supervisor);
  // v9 §3.3 read-through: the end of the FIRST Work-on-this card.
  const report = useDebriefEvent(sessionId, !supervisor);
  const firstEndRef = useRef<HTMLDivElement>(null);
  const onFirstEnd = useCallback(() => report("read_through"), [report]);
  useSeenOnce(firstEndRef, onFirstEnd, !supervisor);
  const corrections = view.corrections ?? [];
  // Sections keep their stored index, the one a flag and a correction name.
  const removed = new Set(corrections.filter(c => c.outcome === "removed").map(c => c.section));
  const flagFor = (section: string) => view.feedback?.flags.find(f => f.section === section);
  // A removed card is gone; say why (the review's note, else Ally's answer
  // to the learner's flag), once per card.
  const removedReasons = [...removed].map(section => ({
    section,
    reason:
      corrections.find(c => c.section === section && c.outcome === "removed")?.note?.trim() ||
      flagFor(section)?.answer?.reply?.trim() ||
      null,
  }));
  const correctionFor = (section: string) => corrections.find(c => c.section === section);
  const flagControl = (section: string, cardLabel: string) =>
    supervisor ? (
      <SupervisorFlag flag={supervisor.flags?.find(f => f.section === section)} />
    ) : (
      <div className="flex flex-wrap items-start gap-1">
        <ListenButton section={section} cardLabel={cardLabel} />
        <CardFlag
          sessionId={sessionId}
          section={section}
          cardLabel={cardLabel}
          flag={flagFor(section)}
          correction={correctionFor(section)}
        />
      </div>
    );
  // A supervisor reads; the learner's buttons are not theirs to press.
  const practiceFor = (id?: number | null) =>
    id == null || supervisor ? undefined : view.practice?.find(p => p.id === id);
  const moment = removed.has("important_moment") ? null : cards.important_moment;
  const worked = cards.what_worked
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => !removed.has(`what_worked[${index}]`));
  const growth = cards.work_on_this
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => !removed.has(`work_on_this[${index}]`));
  const practise = removed.has("practise_next") ? null : cards.practise_next;
  const practiseOption = practiceFor(practise?.scenario_id);
  const tryNext = (Array.isArray(practise?.try_next) ? practise!.try_next : [])
    .filter((x): x is string => typeof x === "string" && !!x.trim())
    .slice(0, 3);
  // A course session (clinical review 2026-11-16): practise this same course
  // item again, with what to try this time.
  const practiseAgain = !!practiseOption?.trackItemId || tryNext.length > 0;
  const practiseTitle = practiseAgain
    ? t("postSim.debriefCards.practiseAgain")
    : t("postSim.debriefCards.practiseNext");
  const progressCard = removed.has("progress_card") ? null : parseProgressCard(cards.progress_card);

  const momentTitle = moment?.handled_well
    ? t("postSim.debriefCards.importantMoment.titleHandledWell")
    : t("postSim.debriefCards.importantMoment.title");

  return (
    <div className="flex flex-col gap-4">
      {view.followUp && !supervisor && (
        <section
          data-testid="debrief-follow-up"
          aria-labelledby="debrief-follow-up-title"
          className="flex flex-col gap-2 rounded-lg border border-primary-200 bg-primary-50 p-4"
        >
          <h3
            id="debrief-follow-up-title"
            className="flex items-center gap-2 font-primary text-base font-semibold text-typography-900"
          >
            <HeartHandshake aria-hidden="true" className="h-5 w-5 text-primary-600" />
            {t("postSim.debriefCards.followUp.title")}
          </h3>
          <Body>{t("postSim.debriefCards.followUp.body")}</Body>
          {!!view.supportLines?.length && <Body>{t("postSim.debriefCards.followUp.support")}</Body>}
        </section>
      )}
      {moment && (
        <ul className="flex flex-col gap-4">
          <Card
            testId="debrief-card-important-moment"
            readSection="important_moment"
            tone="attention"
            // PRD §6.2, case 3: a risk cue the learner handled well is named as theirs.
            title={momentTitle}
            icon={<Bookmark aria-hidden="true" className="h-5 w-5 text-warning-700" />}
          >
            <Lead>{moment.lead}</Lead>
            <Quote text={moment.quote} />
            <Body>{moment.body}</Body>
            {!!moment.others?.length && (
              <div className="flex flex-col gap-2">
                <Lead>{t("postSim.debriefCards.importantMoment.others")}</Lead>
                <ul className="flex flex-col gap-2" data-testid="debrief-other-moments">
                  {moment.others.map(other => (
                    <li key={other.turn_index} className="flex flex-col gap-1">
                      <Quote text={other.quote} />
                      <Body>{other.note}</Body>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Body>{t("postSim.debriefCards.importantMoment.support")}</Body>
            {!!view.supportLines?.length && <SupportLines lines={view.supportLines} />}
            {flagControl("important_moment", momentTitle)}
          </Card>
        </ul>
      )}

      <p
        data-testid="debrief-card-opening"
        className="font-primary text-base leading-relaxed text-typography-800"
      >
        {cards.opening}
      </p>

      <ul className="flex flex-col gap-4">
        {worked.length > 0 && (
          <Card
            testId="debrief-card-what-worked"
            // Open when the learner flagged a point or a reviewer answered one: the reply must not hide behind a click.
            collapsible={
              !supervisor &&
              !worked.some(
                ({ index }) =>
                  !!flagFor(`what_worked[${index}]`) || !!correctionFor(`what_worked[${index}]`),
              )
            }
            readSections={worked.map(({ index }) => `what_worked[${index}]`)}
            title={t("postSim.debriefCards.whatWorked")}
            icon={<ThumbsUp aria-hidden="true" className="h-5 w-5 text-success-600" />}
          >
            <ul className="flex flex-col gap-4">
              {worked.map(({ item, index }) => (
                <ReadableItem key={`${item.turn_index}-${index}`} section={`what_worked[${index}]`}>
                  <Lead>{item.lead}</Lead>
                  <Quote text={item.quote} />
                  <Body>{item.body}</Body>
                  {flagControl(`what_worked[${index}]`, item.lead)}
                </ReadableItem>
              ))}
            </ul>
          </Card>
        )}

        {growth.length > 0 && (
          <Card
            testId="debrief-card-work-on-this"
            title={t("postSim.debriefCards.workOnThis")}
            icon={<Target aria-hidden="true" className="h-5 w-5 text-warning-700" />}
          >
            <ul className="flex flex-col gap-4">
              {growth.map(({ item, index }, shown) => (
                <ReadableItem
                  key={`${item.turn_index}-${index}`}
                  section={`work_on_this[${index}]`}
                >
                  <Lead>{item.lead}</Lead>
                  <Quote text={item.quote} />
                  <Body>{item.why}</Body>
                  <p
                    data-testid="debrief-try-saying"
                    className="flex gap-2 rounded-md border-l-4 border-warning-400 bg-warning-50 px-3 py-2 font-primary text-sm text-typography-900"
                  >
                    <MessageSquareQuote
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-warning-700"
                    />
                    <span>
                      <strong className="font-semibold">
                        {t("postSim.debriefCards.trySaying")}
                      </strong>{" "}
                      {item.try_saying}
                    </span>
                  </p>
                  {practiceFor(item.scenario_id) && (
                    <PractiseLink scenario={practiceFor(item.scenario_id)!} />
                  )}
                  {flagControl(`work_on_this[${index}]`, item.lead)}
                  {shown === 0 && (
                    <div
                      ref={firstEndRef}
                      data-testid="debrief-first-work-end"
                      aria-hidden="true"
                    />
                  )}
                </ReadableItem>
              ))}
            </ul>
            <div ref={readEndRef} data-testid="debrief-read-end" aria-hidden="true" />
          </Card>
        )}

        {practise && (
          <Card
            testId="debrief-card-practise-next"
            readSection="practise_next"
            title={practiseTitle}
            icon={<Sprout aria-hidden="true" className="h-5 w-5 text-primary-600" />}
          >
            {practise.skill ? <Lead>{practise.skill}</Lead> : null}
            <Body>{practise.reason}</Body>
            {tryNext.length > 0 && (
              <div data-testid="debrief-practise-try">
                <p className="font-primary text-sm font-semibold text-typography-900">
                  {t("postSim.debriefCards.practise.tryFollowing")}
                </p>
                <ul className="mt-1 list-disc ps-5 font-primary text-sm leading-relaxed text-typography-800">
                  {tryNext.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {practiseOption ? (
              <PractiseLink
                scenario={practiseOption}
                primary
                again={practiseAgain}
                onClick={() => report("practise_next_click")}
              />
            ) : (
              // Never the card without a way to practise: with no roleplay
              // the learner can still open, their roleplays list. A
              // supervisor reading someone else's debrief gets the text only
              // — it is not theirs to start.
              !supervisor && (
                <Link
                  to={ROLEPLAYS_PATH}
                  onClick={() => report("practise_next_click")}
                  data-testid="debrief-practise-roleplays"
                  className="inline-flex min-h-[44px] items-center justify-center self-start rounded-md bg-primary-600 px-4 font-primary text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
                >
                  {t("postSim.debriefCards.practise.roleplays")}
                </Link>
              )
            )}
            {flagControl("practise_next", practiseTitle)}
          </Card>
        )}

        {cards.skill_words.length > 0 && (
          <Card
            testId="debrief-card-skill-words"
            collapsible={!supervisor}
            title={t("postSim.debriefCards.skillWords.title")}
            icon={<Star aria-hidden="true" className="h-5 w-5 text-primary-600" />}
          >
            <ul className="flex flex-col gap-2">
              {cards.skill_words.map(({ skill, word }) => (
                <li
                  key={skill}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 font-primary text-sm"
                >
                  <span className="font-medium text-typography-900">{skill}</span>
                  <span className="flex items-center gap-1 text-typography-700">
                    {SKILL_WORD_ICON[word]}
                    {t(`postSim.debriefCards.skillWords.${word}`)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {cards.progress_note && (
          <Card
            testId="debrief-card-progress-note"
            collapsible={!supervisor}
            title={t("postSim.debriefCards.progressNote")}
            icon={<TrendingUp aria-hidden="true" className="h-5 w-5 text-primary-600" />}
          >
            <Body>{cards.progress_note}</Body>
          </Card>
        )}

        {!moment && view.riskCue && !view.distress && !!view.supportLines?.length && (
          <Card
            testId="debrief-card-support"
            title={t("postSim.debriefCards.support.title")}
            icon={<HeartHandshake aria-hidden="true" className="h-5 w-5 text-primary-600" />}
          >
            <Body>{t("postSim.debriefCards.support.lead")}</Body>
            <SupportLines lines={view.supportLines} />
          </Card>
        )}

        {cards.reflective_question?.trim() ? (
          <Card
            testId="debrief-card-reflective-question"
            readSection="reflective_question"
            title={t("postSim.debriefCards.reflectiveQuestion")}
            icon={<HelpCircle aria-hidden="true" className="h-5 w-5 text-primary-600" />}
          >
            <Body>{cards.reflective_question}</Body>
            <ListenButton
              section="reflective_question"
              cardLabel={t("postSim.debriefCards.reflectiveQuestion")}
            />
            {replyThread}
          </Card>
        ) : (
          // A short debrief may come without a question (its rule checks don't require one):
          // no empty "One question to think about" card, but Ask Ally stays.
          replyThread && (
            <li
              data-testid="debrief-ask-ally-no-question"
              className="flex flex-col gap-3 rounded-lg border border-primary-100 bg-white p-4"
            >
              {replyThread}
            </li>
          )
        )}
      </ul>
      {removedReasons.length > 0 && (
        <ul data-testid="debrief-removed-note" className="flex flex-col gap-1">
          {removedReasons.map(({ section, reason }) => (
            <li key={section} className="font-primary text-xs text-typography-700">
              {reason
                ? t("postSim.debriefCards.corrections.removedBecause", { reason })
                : t("postSim.debriefCards.corrections.removed")}
            </li>
          ))}
        </ul>
      )}
      {supervisor ? (
        <p
          data-testid="debrief-supervisor-helpful"
          className="font-primary text-sm text-typography-800"
        >
          {supervisor.helpful === true
            ? t("postSim.debriefCards.supervisor.helpfulYes")
            : supervisor.helpful === false
              ? t("postSim.debriefCards.supervisor.helpfulNo")
              : t("postSim.debriefCards.supervisor.helpfulNone")}
        </p>
      ) : (
        <>
          <DebriefHelpful sessionId={sessionId} helpful={view.feedback?.helpful ?? null} />
          {view.pulse && <DebriefPulseCard sessionId={sessionId} pulse={view.pulse} />}
        </>
      )}
      {/* Progress contract §4: below the debrief, only when the card is due. */}
      {progressCard && (
        <DebriefProgressCard
          card={progressCard}
          controls={flagControl(
            "progress_card",
            t("postSim.debriefCards.progressCard.title", { n: progressCard.sessions }),
          )}
        />
      )}
    </div>
  );
};
