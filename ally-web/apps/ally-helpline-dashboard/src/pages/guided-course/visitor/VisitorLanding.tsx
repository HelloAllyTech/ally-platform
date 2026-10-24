import { FC, useEffect, useState } from "react";

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useGetPublicTrackOutlineQuery } from "@api";
import { ROUTES } from "@constants";

import { AllyPresence } from "../presence/AllyPresence";

import type { GuideJourney } from "../hooks/useGuideJourney";

const MAX_OUTCOMES = 3;
/** The story waits this long at most; after that the entry chips show (D5). */
const STORY_WAIT_MS = 1500;

const chip =
  "min-h-11 rounded-lg border border-[var(--g-line)] bg-[var(--g-card)] px-4 text-left font-primary text-[15px] text-[var(--g-ink)] hover:border-[var(--g-ink-faint)] disabled:opacity-50";

/** The first sentence of a description, for a course with no story line. */
const firstSentence = (text: string | null | undefined): string | null => {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  const match = /^.+?[.!?।](\s|$)/u.exec(trimmed);
  return (match ? match[0] : trimmed).trim();
};

/**
 * A visitor's first ten seconds (plan §5.14): the orb, one line of story and
 * the first-move replies above the fold; a course without a story frame gets
 * the outline greeting and the three entry chips instead (D5). Below, a
 * quiet course card and the AI disclosure with a link to how Ally works.
 *
 * The story comes from the course's public outline (the same one the
 * landing page uses); when that isn't public, the course description stands
 * in. The line and chips wait for it, briefly, so nothing changes under the
 * visitor's finger (plan §5.13: CLS < 0.1).
 */
export const VisitorLanding: FC<{
  journey: GuideJourney;
  trackId: string;
  courseTitle: string;
}> = ({ journey, trackId, courseTitle }) => {
  const { t, i18n } = useTranslation();
  const { actions, session, bootstrap, spine } = journey;
  const busy = session.turn !== "idle";
  const { data: outline, isLoading } = useGetPublicTrackOutlineQuery(
    { trackId, languageCode: i18n.language },
    { skip: !trackId },
  );
  const [waitedEnough, setWaitedEnough] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaitedEnough(true), STORY_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  const settled = !isLoading || waitedEnough;

  const story = outline?.story ?? null;
  const replies = story?.firstMove?.replies ?? [];
  const storyLine = story?.hook ?? null;
  const prompt = story?.firstMove ? (story.firstMove.prompt ?? story.firstMove.personaLine) : null;
  const greeting = firstSentence(bootstrap?.course.description) ?? t("guide.welcome.line");

  const minutes = bootstrap?.course.estimatedMinutes || outline?.estimatedDurationMinutes || 0;
  const items = spine.total || outline?.totalItems || 0;
  const outcomes = (story?.outcomes ?? []).slice(0, MAX_OUTCOMES);
  const meta = [
    minutes ? t("guide.visitor.minutes", { count: minutes }) : null,
    items ? t("guide.visitor.items", { count: items }) : null,
  ].filter(Boolean);

  const send = (text: string, verb: string) =>
    actions.submitTurn({ text, source: "landing", verb });

  return (
    <section className="g-rise flex flex-col items-start gap-5 pt-4" data-testid="visitor-landing">
      <AllyPresence state={busy || !settled ? "thinking" : "idle"} size={64} />
      {!settled ? (
        <p className="g-label text-[var(--g-ally-label)]">{t("guide.header.disclosure")}</p>
      ) : (
        <>
          <div>
            <p className="g-label text-[var(--g-ally-label)]">{t("guide.header.disclosure")}</p>
            {storyLine ? (
              <>
                <h1 className="mt-1 font-primary text-[28px] font-semibold leading-[34px] text-[var(--g-ink)] [text-wrap:balance] md:text-[36px] md:leading-[42px]">
                  {storyLine}
                </h1>
                {prompt && <p className="g-prose mt-2 text-[var(--g-ink-soft)]">{prompt}</p>}
              </>
            ) : (
              <>
                <h1 className="mt-1 font-primary text-[28px] font-semibold leading-[34px] text-[var(--g-ink)] [text-wrap:balance] md:text-[36px] md:leading-[42px]">
                  {courseTitle}
                </h1>
                <p className="g-prose mt-2 text-[var(--g-ink-soft)]">{greeting}</p>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-2" data-testid="landing-chips">
            {replies.length >= 2
              ? replies.map((reply, index) => (
                  <button
                    key={reply.label}
                    type="button"
                    disabled={busy}
                    onClick={() => send(reply.text, `firstMove${index + 1}`)}
                    className={chip}
                  >
                    {reply.label}
                  </button>
                ))
              : (
                  [
                    ["whatWillILearn", t("guide.welcome.whatWillILearn")],
                    ["howLong", t("guide.welcome.howLong")],
                    ["start", t("guide.welcome.start")],
                  ] as const
                ).map(([verb, label]) => (
                  <button
                    key={verb}
                    type="button"
                    disabled={busy}
                    onClick={() => send(label, verb)}
                    className={chip}
                  >
                    {label}
                  </button>
                ))}
          </div>
        </>
      )}

      <div
        className="w-full rounded-2xl border border-[var(--g-line)] bg-[var(--g-card)] p-4"
        data-testid="landing-course-card"
      >
        {storyLine && <p className="g-title">{courseTitle}</p>}
        {meta.length > 0 && <p className="g-caption mt-1">{meta.join(" · ")}</p>}
        {outcomes.length > 0 && (
          <>
            <p className="g-label mt-3 text-[var(--g-ink-soft)]">{t("guide.visitor.outcomes")}</p>
            <ul className="mt-1 list-disc pl-5 font-secondary text-base text-[var(--g-ink)]">
              {outcomes.map(outcome => (
                <li key={outcome}>{outcome}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <p className="g-caption" data-testid="landing-disclosure">
        {t("guide.visitor.disclosure")}{" "}
        <Link to={ROUTES.PRIVACY} className="text-[var(--g-ink-soft)] underline underline-offset-2">
          {t("guide.visitor.howItWorks")}
        </Link>
      </p>
    </section>
  );
};
