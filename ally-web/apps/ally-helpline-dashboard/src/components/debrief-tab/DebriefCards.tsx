import {
  FC,
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Bookmark,
  Check,
  ChevronDown,
  CircleDashed,
  HeartHandshake,
  HelpCircle,
  Loader2,
  RefreshCw,
  MessageSquareQuote,
  Phone,
  Sprout,
  Star,
  Target,
  ThumbsUp,
  TrendingUp,
} from "lucide-react";
import i18next, { type i18n } from "i18next";
import { I18nextProvider, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  DebriefCardsData,
  DebriefSkillWord,
  DebriefSupportLine,
  LearnerDebriefView,
  SupervisorDebriefFlag,
} from "@types";

import { CardFlag, DebriefHelpful, DebriefPulseCard } from "./DebriefCardFeedback";
import { DebriefExplainer } from "./DebriefExplainer";
import {
  ListenAllBar,
  ListenButton,
  ReadAloudContext,
  ReadAloudStatusLine,
  useIsBeingRead,
} from "./ReadAloudControls";
import { useDebriefReadAloud } from "./useDebriefReadAloud";
import {
  useDebriefEvent,
  useMarkOpened,
  useReadToTheEnd,
  useSeenOnce,
  useWaitingEvents,
} from "./useReadToTheEnd";

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

/** PRD §6.3: each quote opens the transcript at the turn it came from. */
const SeeMomentContext = createContext<((quote: string) => void) | null>(null);

const Quote: FC<{ text: string }> = ({ text }) => {
  const { t } = useTranslation();
  const seeMoment = useContext(SeeMomentContext);
  return (
    <div className="flex flex-col gap-1">
      <blockquote className="border-l-2 border-primary-200 pl-3 font-primary text-sm italic text-typography-700">
        “{text}”
      </blockquote>
      {seeMoment && (
        <button
          type="button"
          onClick={() => seeMoment(text)}
          className="inline-flex min-h-[44px] items-center self-start rounded-md px-2 font-primary text-xs font-semibold text-primary-700 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
        >
          {t("postSim.debrief.momentLabel")}
        </button>
      )}
    </div>
  );
};

/** One card in the debrief: a list item with a heading. */
const Card: FC<{
  title: string;
  icon: ReactNode;
  tone?: "neutral" | "attention";
  children: ReactNode;
  testId?: string;
  /** The section read-aloud reads for this card, for its highlight. */
  readSection?: string;
}> = ({ title, icon, tone = "neutral", children, testId, readSection }) => {
  const reading = useIsBeingRead(readSection ?? "");
  return (
    <li
      data-testid={testId}
      data-reading={reading || undefined}
      className={`${
        tone === "attention"
          ? "flex flex-col gap-3 rounded-lg border-2 border-warning-300 bg-warning-50 p-4"
          : "flex flex-col gap-3 rounded-lg border border-primary-100 bg-white p-4"
      } ${reading ? "ring-2 ring-primary-400 ring-offset-2" : ""}`}
    >
      <h3 className="flex items-center gap-2 font-primary text-base font-semibold text-typography-900">
        {icon}
        {title}
      </h3>
      {children}
    </li>
  );
};

const Body: FC<{ children: ReactNode }> = ({ children }) => (
  <p className="font-primary text-sm leading-relaxed text-typography-800">{children}</p>
);

const Lead: FC<{ children: ReactNode }> = ({ children }) => (
  <h4 className="font-primary text-sm font-semibold text-typography-900">{children}</h4>
);

/**
 * `ROUTES.SCENARIO` for one roleplay. Built here rather than imported: the
 * routes module loads icons at import time, which this card list must not.
 */
const scenarioPath = (id: number) => `/scenario/${id}`;

/**
 * "Practise this next" / "Practise this": opens the roleplay's own page, so
 * its language choice and trigger warnings come first. Rendered only for a
 * roleplay the server says the learner can still open.
 */
const PractiseLink: FC<{
  scenario: { id: number; title: string };
  primary?: boolean;
  onClick?: () => void;
}> = ({ scenario, primary, onClick }) => {
  const { t } = useTranslation();
  return (
    <Link
      to={scenarioPath(scenario.id)}
      onClick={onClick}
      data-testid={primary ? "debrief-practise-next" : "debrief-practise-this"}
      aria-label={t("postSim.debriefCards.practise.label", { title: scenario.title })}
      className={
        primary
          ? "inline-flex min-h-[44px] items-center justify-center self-start rounded-md bg-primary-600 px-4 font-primary text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
          : "inline-flex min-h-[44px] items-center gap-1 self-start rounded-md px-2 font-primary text-sm font-semibold text-primary-700 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
      }
    >
      {primary ? t("postSim.debriefCards.practise.next") : t("postSim.debriefCards.practise.this")}
    </Link>
  );
};

/** The organisation's support lines, each number a tap-to-call link. */
const SupportLines: FC<{ lines: DebriefSupportLine[] }> = ({ lines }) => (
  <ul className="flex flex-col gap-2" data-testid="debrief-support-lines">
    {lines.map(line => (
      <li key={`${line.name}-${line.phone}`} className="flex flex-col font-primary text-sm">
        <a
          href={`tel:${line.phone.replace(/[^\d+]/g, "")}`}
          className="inline-flex min-h-[44px] items-center gap-2 font-semibold text-typography-900 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
        >
          <Phone aria-hidden="true" className="h-4 w-4 shrink-0 text-primary-600" />
          {line.name} · {line.phone}
        </a>
        {line.hours && <span className="pl-6 text-xs text-typography-700">{line.hours}</span>}
      </li>
    ))}
  </ul>
);

/** What the learner said about one card, and the outcome — for a supervisor. */
const SupervisorFlag: FC<{ flag?: SupervisorDebriefFlag }> = ({ flag }) => {
  const { t } = useTranslation();
  if (!flag) return null;
  const outcome =
    flag.status === "kept"
      ? t("postSim.debriefCards.supervisor.kept", { note: flag.resolutionNote ?? "" })
      : flag.status === "corrected"
        ? t("postSim.debriefCards.supervisor.corrected", { note: flag.resolutionNote ?? "" })
        : flag.status === "removed"
          ? t("postSim.debriefCards.supervisor.removed")
          : t("postSim.debriefCards.supervisor.waiting");
  return (
    <div
      data-testid="debrief-supervisor-flag"
      className="flex flex-col gap-1 rounded-md border-l-4 border-warning-400 bg-warning-50 px-3 py-2 font-primary text-xs text-typography-900"
    >
      <span>
        {t("postSim.debriefCards.supervisor.flagged", {
          reason: flag.reason ? t(`postSim.debriefCards.flag.reasons.${flag.reason}`) : "",
        })}
      </span>
      {flag.note && <span>{t("postSim.debriefCards.supervisor.note", { note: flag.note })}</span>}
      <span>{outcome}</span>
    </div>
  );
};

/** A card item that gets a ring while read-aloud is reading it. */
const ReadableItem: FC<{ section: string; children: ReactNode }> = ({ section, children }) => {
  const reading = useIsBeingRead(section);
  return (
    <li
      data-reading={reading || undefined}
      className={`flex flex-col gap-2 rounded-md ${reading ? "ring-2 ring-primary-400 ring-offset-2" : ""}`}
    >
      {children}
    </li>
  );
};

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
  ].filter((x): x is string => !!x && !removed.has(x));
};

const ReadyCards: FC<{
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

  const momentTitle = moment?.handled_well
    ? t("postSim.debriefCards.importantMoment.titleHandledWell")
    : t("postSim.debriefCards.importantMoment.title");

  return (
    <div className="flex flex-col gap-4">
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
            title={t("postSim.debriefCards.practiseNext")}
            icon={<Sprout aria-hidden="true" className="h-5 w-5 text-primary-600" />}
          >
            <Lead>{practise.skill}</Lead>
            <Body>{practise.reason}</Body>
            {practiceFor(practise.scenario_id) && (
              <PractiseLink
                scenario={practiceFor(practise.scenario_id)!}
                primary
                onClick={() => report("practise_next_click")}
              />
            )}
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
      </ul>
      {removed.size > 0 && (
        <p data-testid="debrief-removed-note" className="font-primary text-xs text-typography-700">
          {t("postSim.debriefCards.corrections.removed")}
        </p>
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
    </div>
  );
};

/**
 * When the learner stepped out of the role in distress (plan flow C), care
 * comes before coaching: an acknowledgement and the support lines first, and
 * the debrief collapsed until the learner chooses to open it.
 */
const DistressFirst: FC<{ view: LearnerDebriefView; children: ReactNode }> = ({
  view,
  children,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <section
        data-testid="debrief-distress"
        aria-labelledby="debrief-distress-title"
        className="flex flex-col gap-3 rounded-lg border border-primary-200 bg-primary-50 p-4"
      >
        <h3
          id="debrief-distress-title"
          className="flex items-center gap-2 font-primary text-base font-semibold text-typography-900"
        >
          <HeartHandshake aria-hidden="true" className="h-5 w-5 text-primary-600" />
          {t("postSim.debriefCards.distress.title")}
        </h3>
        <Body>{t("postSim.debriefCards.distress.body")}</Body>
        {!!view.supportLines?.length && (
          <>
            <Body>{t("postSim.debriefCards.distress.supportLead")}</Body>
            <SupportLines lines={view.supportLines} />
          </>
        )}
      </section>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="debrief-when-ready"
        onClick={() => setOpen(o => !o)}
        className="flex min-h-[44px] items-center justify-between gap-2 rounded-md border border-primary-100 px-4 font-primary text-sm font-semibold text-typography-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
      >
        {t("postSim.debriefCards.distress.whenReady")}
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div id="debrief-when-ready" hidden={!open}>
        {children}
      </div>
    </div>
  );
};

/** What a supervisor sees besides the cards: the learner's flags and answer. */
type SupervisorView = { flags?: SupervisorDebriefFlag[]; helpful?: boolean | null };

interface DebriefCardsProps {
  view: LearnerDebriefView;
  sessionId: string;
  /** Read-only for a supervisor on Roleplay Logs: no buttons, the learner's feedback shown. */
  supervisor?: SupervisorView;
  /** Ask Ally's thread and composer, under the reflective question. */
  replyThread?: ReactNode;
  /** "See this moment" on a quote: open the transcript at that turn. */
  onSeeQuote?: (quote: string) => void;
  /** "Try again" on a debrief that didn't load. */
  onRetry?: () => void;
  /** True while that retry is in flight. */
  retrying?: boolean;
}

/**
 * The Debrief agent's debrief, as structured cards. Only mounted when the
 * learner's organisation is switched on — `not_available` reaches here only
 * after an emergency stop (see `useLearnerDebrief`).
 *
 * No score, no percentage and no red anywhere: amber marks what needs
 * attention, and every status carries text plus an icon, never colour alone.
 */
/** Scripts that need more line height than Latin to stay legible (NFR-6: ≥ 1.6). */
const INDIC_LANGUAGES = new Set(["hi", "mr", "ta", "kn", "bn", "ml", "te", "gu", "pa", "or"]);
export const isIndicLanguage = (language?: string | null): boolean =>
  INDIC_LANGUAGES.has(toLangAttribute(language) ?? "");

/**
 * A separate i18next instance over the app's translations, fixed to the
 * debrief's language. Not `cloneInstance`: a clone shares the language
 * detector, and switching it would save the debrief's language as the app's.
 */
const debriefLanguageInstance = (app: i18n, lng: string): i18n => {
  const instance = i18next.createInstance();
  void instance.init({
    lng,
    fallbackLng: "en",
    resources: app.store.data,
    returnEmptyString: false,
    interpolation: { escapeValue: false },
    initImmediate: false,
  });
  return instance;
};

/**
 * PRD §9: everything in the debrief follows the session's language, labels
 * included, whatever language the app is in. Languages without reviewed UI
 * copy fall back to English labels (i18next's fallback).
 */
export const DebriefCards: FC<DebriefCardsProps> = props => {
  const { i18n } = useTranslation();
  const lng = toLangAttribute(props.view.language);
  const debriefI18n = useMemo(
    () =>
      lng && i18n?.store && lng !== toLangAttribute(i18n.language)
        ? debriefLanguageInstance(i18n, lng)
        : null,
    [i18n, lng],
  );
  if (!debriefI18n) return <DebriefCardsInLanguage {...props} />;
  return (
    <I18nextProvider i18n={debriefI18n}>
      <DebriefCardsInLanguage {...props} />
    </I18nextProvider>
  );
};

const DebriefCardsInLanguage: FC<DebriefCardsProps> = ({
  view,
  sessionId,
  replyThread,
  supervisor,
  onSeeQuote,
  onRetry,
  retrying = false,
}) => {
  const { t } = useTranslation();
  const readAloud = useDebriefReadAloud(sessionId);
  // Read-aloud is the learner's: its audio links are theirs alone.
  const ready = view.state === "ready" && !!view.cards && !supervisor;
  // v9 §3.3 "abandoned before ready": waited on the working screen, left early.
  const reportWaiting = useDebriefEvent(sessionId, !supervisor);
  useWaitingEvents(view.state === "working", reportWaiting, !supervisor);
  const latestStep = view.steps?.length ? view.steps[view.steps.length - 1] : undefined;
  const progressLine = (): string => {
    const p = view.progress;
    if (!p) return latestStep || t("postSim.debriefCards.working.defaultStep");
    if (p.key === "guidance" && p.topic) {
      return t("postSim.debriefCards.working.steps.guidanceTopic", { topic: p.topic });
    }
    if (p.key === "revising") {
      return t("postSim.debriefCards.working.steps.revising", { round: p.round });
    }
    return t(`postSim.debriefCards.working.steps.${p.key}`);
  };

  // FR-27: the steps already done stay on the panel as quiet ticks, in the
  // order the run took them; the current one keeps the spinner.
  const currentLine = view.state === "working" ? progressLine() : null;
  const [doneLines, setDoneLines] = useState<string[]>([]);
  const lastLine = useRef<string | null>(null);
  useEffect(() => {
    if (!currentLine) return;
    const previous = lastLine.current;
    if (previous && previous !== currentLine) {
      setDoneLines(d => (d.includes(previous) ? d : [...d, previous]));
    }
    lastLine.current = currentLine;
  }, [currentLine]);

  // Plan §7.8: when a debrief the learner waited for is ready, focus moves to
  // the heading (never on a page that opened on a ready debrief).
  const headingRef = useRef<HTMLHeadingElement>(null);
  const wasWorking = useRef(false);
  useEffect(() => {
    if (view.state === "working") wasWorking.current = true;
    else if (wasWorking.current && view.state === "ready" && view.cards) {
      wasWorking.current = false;
      headingRef.current?.focus();
    }
  }, [view.state, view.cards]);

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
          <ul className="flex flex-col gap-1" data-testid="debrief-working-steps">
            {doneLines
              .filter(line => line !== currentLine)
              .map(line => (
                <li
                  key={line}
                  className="flex items-center gap-1.5 font-primary text-sm text-typography-600"
                >
                  <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-primary-600" />
                  {line.replace(/…$/, "")}
                </li>
              ))}
            <li className="font-primary text-sm text-typography-700" aria-current="step">
              {currentLine}
            </li>
          </ul>
        </div>
      </div>
    );
  } else if (view.state === "taking_longer") {
    // Plan §7.5 / §10.3: a person is finishing it (no risk cue). Calm, not a
    // failure; the learner can check again rather than wait on a poll.
    content = (
      <div data-testid="debrief-taking-longer" className="flex flex-col gap-3">
        <div role="status" aria-live="polite">
          <Body>{t("postSim.debriefCards.takingLonger.body")}</Body>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex min-h-[44px] items-center gap-2 self-start rounded-full border border-primary-200 bg-primary-50 px-4 font-primary text-sm font-semibold text-primary-600 transition-colors hover:bg-primary-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-60"
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-4 w-4 ${retrying ? "animate-spin motion-reduce:animate-none" : ""}`}
            />
            {retrying
              ? t("postSim.debriefCards.takingLonger.checking")
              : t("postSim.debriefCards.takingLonger.checkAgain")}
          </button>
        )}
      </div>
    );
  } else if (view.state === "on_its_way") {
    content = <Body>{t("postSim.debriefCards.onItsWay")}</Body>;
  } else if (view.state === "not_available") {
    // FR-46: the organisation's debriefs were stopped (only sent with `stopped`).
    content = (
      <div data-testid="debrief-not-available">
        <Body>{t("postSim.debriefCards.notAvailable")}</Body>
      </div>
    );
  } else if (view.state === "too_short") {
    content = <Body>{t("postSim.debriefCards.tooShort")}</Body>;
  } else if (view.state === "failed") {
    // PRD §6.12 "failed": the request itself failed. Amber, never red; the
    // debrief is safe, so say so and offer one way forward.
    content = (
      <div
        role="alert"
        data-testid="debrief-failed"
        className="flex flex-col gap-3 rounded-lg border-2 border-warning-300 bg-warning-50 p-4"
      >
        <h3 className="font-primary text-base font-semibold text-typography-900">
          {t("postSim.debriefCards.failed.title")}
        </h3>
        <Body>{t("postSim.debriefCards.failed.body")}</Body>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex min-h-[44px] items-center gap-2 self-start rounded-md bg-primary-600 px-4 font-primary text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-60"
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-4 w-4 ${retrying ? "animate-spin motion-reduce:animate-none" : ""}`}
            />
            {retrying
              ? t("postSim.debriefCards.failed.retrying")
              : t("postSim.debriefCards.failed.retry")}
          </button>
        )}
      </div>
    );
  } else if (view.state === "ready" && view.cards) {
    const cards = (
      <ReadyCards
        cards={view.cards}
        view={view}
        sessionId={sessionId}
        replyThread={replyThread}
        supervisor={supervisor}
      />
    );
    content = view.distress ? <DistressFirst view={view}>{cards}</DistressFirst> : cards;
  }

  return (
    <SeeMomentContext.Provider value={onSeeQuote ?? null}>
      <ReadAloudContext.Provider value={ready ? readAloud : null}>
        <div className="flex w-full flex-col rounded-lg bg-gradient-to-br from-primary-500 to-primary-100 p-1">
          <div className="flex w-full items-center justify-between gap-3 px-4 py-3">
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="font-primary text-lg font-semibold text-white focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              {t("postSim.debriefCards.header")}
            </h2>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {ready && <ListenAllBar sections={readableSections(view)} />}
              <span className="rounded-full bg-white/90 px-2.5 py-0.5 font-primary text-xs font-medium text-typography-800">
                {t("postSim.debriefCards.aiLabel")}
              </span>
              <DebriefExplainer />
            </div>
          </div>
          <div
            lang={toLangAttribute(view.language)}
            data-testid="debrief-cards"
            className={`flex flex-col gap-5 rounded-t-lg rounded-b-md bg-white p-4 sm:p-6 ${
              isIndicLanguage(view.language) ? "[&_*]:!leading-[1.7]" : ""
            }`}
          >
            <ReadAloudStatusLine />
            {/* FR-27: screen readers hear when the debrief is ready. */}
            <p className="sr-only" role="status" aria-live="polite">
              {view.state === "ready" && view.cards ? t("postSim.debriefCards.ready.announce") : ""}
            </p>
            {content}
          </div>
        </div>
      </ReadAloudContext.Provider>
    </SeeMomentContext.Provider>
  );
};
