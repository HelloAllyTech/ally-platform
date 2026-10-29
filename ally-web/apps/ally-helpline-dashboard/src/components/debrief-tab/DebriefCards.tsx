import { FC, ReactNode } from "react";

import {
  Bookmark,
  CircleDashed,
  HelpCircle,
  Loader2,
  MessageSquareQuote,
  Sprout,
  Star,
  Target,
  ThumbsUp,
  TrendingUp,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { DebriefCardsData, DebriefSkillWord, LearnerDebriefView } from "@types";

import { CardFlag, DebriefHelpful } from "./DebriefCardFeedback";

/** 'hi-IN' → 'hi'; anything unusable → undefined (inherit the page's lang). */
export const toLangAttribute = (language?: string | null): string | undefined => {
  const base = language?.trim().split(/[-_]/)[0]?.toLowerCase();
  return base ? base : undefined;
};

const SKILL_WORD_ICON: Record<DebriefSkillWord, ReactNode> = {
  strength: <Star aria-hidden="true" className="h-4 w-4 shrink-0 text-success-600" />,
  keep_practising: <Sprout aria-hidden="true" className="h-4 w-4 shrink-0 text-warning-700" />,
  didnt_come_up: (
    <CircleDashed aria-hidden="true" className="h-4 w-4 shrink-0 text-typography-600" />
  ),
};

const Quote: FC<{ text: string }> = ({ text }) => (
  <blockquote className="border-l-2 border-primary-200 pl-3 font-primary text-sm italic text-typography-700">
    “{text}”
  </blockquote>
);

/** One card in the debrief: a list item with a heading. */
const Card: FC<{
  title: string;
  icon: ReactNode;
  tone?: "neutral" | "attention";
  children: ReactNode;
  testId?: string;
}> = ({ title, icon, tone = "neutral", children, testId }) => (
  <li
    data-testid={testId}
    className={
      tone === "attention"
        ? "flex flex-col gap-3 rounded-lg border-2 border-warning-300 bg-warning-50 p-4"
        : "flex flex-col gap-3 rounded-lg border border-primary-100 bg-white p-4"
    }
  >
    <h3 className="flex items-center gap-2 font-primary text-base font-semibold text-typography-900">
      {icon}
      {title}
    </h3>
    {children}
  </li>
);

const Body: FC<{ children: ReactNode }> = ({ children }) => (
  <p className="font-primary text-sm leading-relaxed text-typography-800">{children}</p>
);

const Lead: FC<{ children: ReactNode }> = ({ children }) => (
  <h4 className="font-primary text-sm font-semibold text-typography-900">{children}</h4>
);

const ReadyCards: FC<{ cards: DebriefCardsData; view: LearnerDebriefView; sessionId: string }> = ({
  cards,
  view,
  sessionId,
}) => {
  const { t } = useTranslation();
  const corrections = view.corrections ?? [];
  // Sections keep their stored index, the one a flag and a correction name.
  const removed = new Set(corrections.filter(c => c.outcome === "removed").map(c => c.section));
  const flagFor = (section: string) => view.feedback?.flags.find(f => f.section === section);
  const correctionFor = (section: string) => corrections.find(c => c.section === section);
  const flagControl = (section: string, cardLabel: string) => (
    <CardFlag
      sessionId={sessionId}
      section={section}
      cardLabel={cardLabel}
      flag={flagFor(section)}
      correction={correctionFor(section)}
    />
  );
  const moment = removed.has("important_moment") ? null : cards.important_moment;
  const worked = cards.what_worked
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => !removed.has(`what_worked[${index}]`));
  const growth = cards.work_on_this
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => !removed.has(`work_on_this[${index}]`));
  const practise = removed.has("practise_next") ? null : cards.practise_next;

  return (
    <div className="flex flex-col gap-4">
      {moment && (
        <ul className="flex flex-col gap-4">
          <Card
            testId="debrief-card-important-moment"
            tone="attention"
            title={t("postSim.debriefCards.importantMoment.title")}
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
            {flagControl("important_moment", t("postSim.debriefCards.importantMoment.title"))}
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
            title={t("postSim.debriefCards.whatWorked")}
            icon={<ThumbsUp aria-hidden="true" className="h-5 w-5 text-success-600" />}
          >
            <ul className="flex flex-col gap-4">
              {worked.map(({ item, index }) => (
                <li key={`${item.turn_index}-${index}`} className="flex flex-col gap-2">
                  <Lead>{item.lead}</Lead>
                  <Quote text={item.quote} />
                  <Body>{item.body}</Body>
                  {flagControl(`what_worked[${index}]`, item.lead)}
                </li>
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
              {growth.map(({ item, index }) => (
                <li key={`${item.turn_index}-${index}`} className="flex flex-col gap-2">
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
                  {flagControl(`work_on_this[${index}]`, item.lead)}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {practise && (
          <Card
            testId="debrief-card-practise-next"
            title={t("postSim.debriefCards.practiseNext")}
            icon={<Sprout aria-hidden="true" className="h-5 w-5 text-primary-600" />}
          >
            <Lead>{practise.skill}</Lead>
            <Body>{practise.reason}</Body>
            {flagControl("practise_next", t("postSim.debriefCards.practiseNext"))}
          </Card>
        )}

        {cards.skill_words.length > 0 && (
          <Card
            testId="debrief-card-skill-words"
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
            title={t("postSim.debriefCards.progressNote")}
            icon={<TrendingUp aria-hidden="true" className="h-5 w-5 text-primary-600" />}
          >
            <Body>{cards.progress_note}</Body>
          </Card>
        )}

        <Card
          testId="debrief-card-reflective-question"
          title={t("postSim.debriefCards.reflectiveQuestion")}
          icon={<HelpCircle aria-hidden="true" className="h-5 w-5 text-primary-600" />}
        >
          <Body>{cards.reflective_question}</Body>
        </Card>
      </ul>
      {removed.size > 0 && (
        <p data-testid="debrief-removed-note" className="font-primary text-xs text-typography-700">
          {t("postSim.debriefCards.corrections.removed")}
        </p>
      )}
      <DebriefHelpful sessionId={sessionId} helpful={view.feedback?.helpful ?? null} />
    </div>
  );
};

interface DebriefCardsProps {
  view: LearnerDebriefView;
  sessionId: string;
}

/**
 * The Debrief agent's debrief, as structured cards. Only mounted when the
 * learner's organisation is switched on — `not_available` never reaches here
 * (see `useLearnerDebrief`).
 *
 * No score, no percentage and no red anywhere: amber marks what needs
 * attention, and every status carries text plus an icon, never colour alone.
 */
export const DebriefCards: FC<DebriefCardsProps> = ({ view, sessionId }) => {
  const { t } = useTranslation();
  const latestStep = view.steps?.length ? view.steps[view.steps.length - 1] : undefined;

  let content: ReactNode = null;
  if (view.state === "working") {
    content = (
      <div
        role="status"
        aria-live="polite"
        data-testid="debrief-working"
        className="flex items-center gap-3 rounded-lg border border-primary-100 bg-primary-50 p-4"
      >
        <Loader2
          aria-hidden="true"
          className="h-5 w-5 shrink-0 animate-spin text-primary-600 motion-reduce:animate-none"
        />
        <div className="flex flex-col gap-1">
          <p className="font-primary text-sm font-semibold text-typography-900">
            {t("postSim.debriefCards.working.title")}
          </p>
          <p className="font-primary text-sm text-typography-700">
            {latestStep || t("postSim.debriefCards.working.defaultStep")}
          </p>
        </div>
      </div>
    );
  } else if (view.state === "on_its_way") {
    content = <Body>{t("postSim.debriefCards.onItsWay")}</Body>;
  } else if (view.state === "too_short") {
    content = <Body>{t("postSim.debriefCards.tooShort")}</Body>;
  } else if (view.state === "ready" && view.cards) {
    content = <ReadyCards cards={view.cards} view={view} sessionId={sessionId} />;
  }

  return (
    <div className="flex w-full flex-col rounded-lg bg-gradient-to-br from-primary-500 to-primary-100 p-1">
      <div className="flex w-full items-center justify-between gap-3 px-4 py-3">
        <h2 className="font-primary text-lg font-semibold text-white">
          {t("postSim.debriefCards.header")}
        </h2>
        <span className="rounded-full bg-white/90 px-2.5 py-0.5 font-primary text-xs font-medium text-typography-800">
          {t("postSim.debriefCards.aiLabel")}
        </span>
      </div>
      <div
        lang={toLangAttribute(view.language)}
        data-testid="debrief-cards"
        className="flex flex-col gap-5 rounded-t-lg rounded-b-md bg-white p-4 sm:p-6"
      >
        {content}
      </div>
    </div>
  );
};
