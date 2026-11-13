import { FC, ReactNode, useId, useState } from "react";

import { ArrowRight, ChevronDown, Ellipsis, Eye, TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useIsBeingRead } from "./ReadAloudControls";

import { DebriefProgressCardData, DebriefProgressTrend } from "@types";

const TRENDS: readonly DebriefProgressTrend[] = [
  "more_consistent",
  "about_the_same",
  "worth_another_look",
  "too_early",
];

const isTrend = (value: unknown): value is DebriefProgressTrend =>
  typeof value === "string" && (TRENDS as readonly string[]).includes(value);

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * `cards.progress_card` (progress contract §2), or null when it is absent or
 * has nothing a learner can read. Skills without a line or with an unknown
 * trend are dropped rather than shown half-empty.
 */
export const parseProgressCard = (raw: unknown): DebriefProgressCardData | null => {
  if (!isRecord(raw)) return null;
  const sessions = raw.sessions;
  if (typeof sessions !== "number" || !Number.isInteger(sessions) || sessions < 1) return null;
  const skills = (Array.isArray(raw.skills) ? raw.skills : []).flatMap(item => {
    if (!isRecord(item)) return [];
    const skill = text(item.skill);
    const line = text(item.line);
    return skill && line && isTrend(item.trend) ? [{ skill, trend: item.trend, line }] : [];
  });
  const focusSkill = isRecord(raw.focus) ? text(raw.focus.skill) : null;
  const focusLine = isRecord(raw.focus) ? text(raw.focus.line) : null;
  const focus = focusSkill && focusLine ? { skill: focusSkill, line: focusLine } : null;
  if (!focus && skills.length === 0) return null;
  return { sessions, skills, focus };
};

/** `open_questions` → "Open questions" when the app has no name for the skill. */
const humanise = (key: string): string => {
  const words = key.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** The skill's name in the debrief's language (the helpline's skill labels), else the key made readable. */
const useSkillName = () => {
  const { t } = useTranslation();
  return (key: string) =>
    /^[a-z][a-z_]*$/i.test(key)
      ? t(`helplineWorkspace.skills.${key}`, { defaultValue: humanise(key) })
      : humanise(key);
};

const TREND_STYLE: Record<DebriefProgressTrend, { icon: ReactNode; className: string }> = {
  more_consistent: {
    icon: <TrendingUp aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />,
    className: "bg-primary-50 text-primary-700",
  },
  about_the_same: {
    icon: <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />,
    className: "bg-gray-100 text-typography-700",
  },
  worth_another_look: {
    icon: <Eye aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />,
    className: "bg-warning-50 text-warning-700",
  },
  too_early: {
    icon: <Ellipsis aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />,
    className: "bg-warning-50 text-warning-700",
  },
};

/**
 * "Your last {n} sessions": how the learner's skills have moved over their
 * recent sessions. Collapsed it shows the one focus (or the first skill's line
 * when there is no focus); "Show more" opens every skill with its trend word.
 * Trend words always carry text and an icon, never colour alone.
 */
export const DebriefProgressCard: FC<{
  card: DebriefProgressCardData;
  /** Listen and "This isn't right" for the learner (or the flag, for a supervisor). */
  controls?: ReactNode;
}> = ({ card, controls }) => {
  const { t } = useTranslation();
  const skillName = useSkillName();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const bodyId = useId();
  const k = "postSim.debriefCards.progressCard";
  const preview = card.focus ?? card.skills[0];
  const reading = useIsBeingRead("progress_card");

  return (
    <section
      data-testid="debrief-card-progress"
      data-reading={reading || undefined}
      aria-labelledby={titleId}
      className={`flex flex-col gap-3 rounded-lg border border-primary-200 bg-primary-50 p-4 ${
        reading ? "ring-2 ring-primary-400 ring-offset-2" : ""
      }`}
    >
      <h3
        id={titleId}
        className="flex items-center gap-2 font-primary text-base font-semibold text-typography-900"
      >
        <TrendingUp aria-hidden="true" className="h-5 w-5 text-primary-600" />
        {t(`${k}.title`, { n: card.sessions })}
      </h3>

      {card.focus ? (
        <div data-testid="debrief-progress-focus" className="flex flex-col gap-1">
          <h4 className="font-primary text-sm font-semibold text-typography-900">
            {t(`${k}.focus`)}: {skillName(card.focus.skill)}
          </h4>
          <p className="font-primary text-sm leading-relaxed text-typography-800">
            {card.focus.line}
          </p>
        </div>
      ) : (
        !open && (
          <p
            data-testid="debrief-progress-preview"
            className="font-primary text-sm leading-relaxed text-typography-800"
          >
            {preview?.line}
          </p>
        )
      )}

      {card.skills.length > 0 && (
        <>
          <ul
            id={bodyId}
            hidden={!open}
            data-testid="debrief-progress-skills"
            className="flex flex-col gap-3"
          >
            {card.skills.map(({ skill, trend, line }) => (
              <li
                key={skill}
                className="flex flex-col gap-1.5 rounded-md border border-primary-100 bg-white p-3"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-primary text-sm font-semibold text-typography-900">
                    {skillName(skill)}
                  </span>
                  <span
                    data-testid="debrief-progress-trend"
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-primary text-xs font-medium ${TREND_STYLE[trend].className}`}
                  >
                    {TREND_STYLE[trend].icon}
                    {t(`${k}.trends.${trend}`)}
                  </span>
                </div>
                <p className="font-primary text-sm leading-relaxed text-typography-800">{line}</p>
              </li>
            ))}
          </ul>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen(o => !o)}
            className="inline-flex min-h-[44px] items-center gap-1 self-start rounded-md px-2 font-primary text-sm font-semibold text-primary-700 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
          >
            {open ? t(`${k}.showLess`) : t(`${k}.showMore`)}
            <ChevronDown
              aria-hidden="true"
              className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
            />
          </button>
        </>
      )}
      {controls}
    </section>
  );
};
