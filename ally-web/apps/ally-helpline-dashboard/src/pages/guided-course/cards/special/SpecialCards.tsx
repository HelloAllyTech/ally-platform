import { FC } from "react";

import { useTranslation } from "react-i18next";

import { TrackAccessDenialReason } from "@types";

import { safetyCopyFor } from "../../copy/safetyCopy";
import { CardFrame } from "../CardFrame";
import { crisisLinesFor } from "./CrisisCard";

import type { GuideCard, GuideCrisisLine } from "../../contract/wire";

const action =
  "inline-flex min-h-10 items-center rounded-[10px] bg-[var(--g-action)] px-4 font-primary text-[15px] font-semibold text-[var(--g-on-action)] max-md:min-h-11";

const payloadOf = (card: GuideCard) => (card.payload ?? {}) as Record<string, unknown>;
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

const DENIAL_LINE: Record<TrackAccessDenialReason, string> = {
  NOT_AVAILABLE: "guide.denied.notAvailable",
  NO_ORGANIZATION: "guide.denied.noOrganization",
  NOT_IN_ORGANIZATION: "guide.denied.notInOrganization",
  NOT_IN_GROUP: "guide.denied.notInGroup",
};

/**
 * "This course isn't open to you yet" (card grammar §5.5). Nothing the
 * learner can change here, so no retry; Ally doesn't apologise for what
 * isn't Ally's failure, and doesn't speculate.
 */
export const AccessDeniedCard: FC<{
  reason: TrackAccessDenialReason | null;
  onMyCourses: () => void;
}> = ({ reason, onMyCourses }) => {
  const { t } = useTranslation();
  return (
    <section
      data-testid="access-denied-card"
      aria-labelledby="guide-denied-title"
      className="rounded-2xl border border-[var(--g-line)] bg-[var(--g-card)] p-5"
    >
      <h2 id="guide-denied-title" className="g-label text-[var(--g-ink-faint)]">
        {t("guide.denied.title")}
      </h2>
      <p className="g-prose mt-2">
        {t(reason ? DENIAL_LINE[reason] : "guide.denied.notAvailable")}
      </p>
      <button type="button" onClick={onMyCourses} className={`${action} mt-4`}>
        {t("guide.common.myCourses")}
      </button>
    </section>
  );
};

/** "Sign in to save your place" (card grammar §5.6). Opens the existing LoginDialog. */
export const SignInCard: FC<{ onSignIn: () => void }> = ({ onSignIn }) => {
  const { t } = useTranslation();
  return (
    <section
      data-testid="sign-in-card"
      aria-labelledby="guide-sign-in-title"
      className="rounded-2xl border border-[var(--g-line)] bg-[var(--g-card)] p-5"
    >
      <h2 id="guide-sign-in-title" className="g-title">
        {t("guide.signIn.title")}
      </h2>
      <p className="mt-1 font-secondary text-base text-[var(--g-ink-soft)]">
        {t("guide.signIn.line")}
      </p>
      <button type="button" onClick={onSignIn} className={`${action} mt-4`}>
        {t("guide.signIn.button")}
      </button>
    </section>
  );
};

/**
 * Optional practice (card grammar §4): Ally's own card, so it wears the clay
 * wash and says it doesn't count. Skip is always there and never shamed.
 * The seven kinds and their interactions land with the Coach in M3; until
 * then a card carries a prompt and, optionally, choices that reply in the
 * conversation.
 */
export const MicroActivityCard: FC<{
  card: GuideCard;
  onChoose: (text: string) => void;
  onTry: () => void;
  onSkip: () => void;
}> = ({ card, onChoose, onTry, onSkip }) => {
  const { t } = useTranslation();
  const payload = payloadOf(card);
  const kind = text(payload.practiceKind);
  const prompt = text(payload.prompt) ?? card.framing ?? null;
  const options = Array.isArray(payload.options)
    ? (payload.options as unknown[]).filter((o): o is string => typeof o === "string")
    : [];
  const minutes = card.meta?.minutes;
  const meta = [kind, minutes ? t("guide.card.meta.minutes", { count: minutes }) : null]
    .filter(Boolean)
    .join(" · ");

  if (card.state === "dismissed") {
    return <p className="g-caption">{t("guide.practice.skipped")}</p>;
  }
  if (card.state === "failed") {
    return <p className="g-caption">{t("guide.practice.failed")}</p>;
  }

  return (
    <CardFrame
      testId={`card-${card.cardId}`}
      state={card.state}
      surface="ally"
      typeWord={t("guide.practice.label")}
      meta={meta || null}
      title={card.title}
      framing={prompt}
      receipt={card.state === "done" ? card.title : null}
      primary={
        options.length || card.state !== "ready"
          ? null
          : { label: card.cta?.label ?? t("guide.practice.try"), onClick: onTry }
      }
      secondary={
        card.state === "ready" ? { label: t("guide.practice.skip"), onClick: onSkip } : null
      }
      footer={<p className="g-caption mt-3">{t("guide.practice.footer")}</p>}
    >
      {options.length > 0 && card.state === "ready" && (
        <div className="mt-3 flex flex-col gap-2">
          {options.map(option => (
            <button
              key={option}
              type="button"
              onClick={() => onChoose(option)}
              className="min-h-11 rounded-[10px] border border-[var(--g-ally-edge)] bg-[var(--g-card)] px-4 py-2 text-left font-secondary text-base text-[var(--g-ink)]"
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </CardFrame>
  );
};

/** Course info (card grammar §5.6): the same facts as the landing's course card. */
export const CourseInfoCard: FC<{ card: GuideCard; onOpen: () => void }> = ({ card, onOpen }) => {
  const { t } = useTranslation();
  const payload = payloadOf(card);
  const outcomes = Array.isArray(payload.outcomes)
    ? (payload.outcomes as unknown[]).filter((o): o is string => typeof o === "string").slice(0, 3)
    : [];
  return (
    <CardFrame
      testId={`card-${card.cardId}`}
      state={card.state === "active" ? "ready" : card.state}
      surface="course"
      glyph="page"
      typeWord={t("guide.courseInfo.label")}
      meta={card.meta?.minutes ? t("guide.card.meta.minutes", { count: card.meta.minutes }) : null}
      title={card.title}
      framing={card.framing}
      primary={{ label: card.cta?.label ?? t("guide.courseInfo.open"), onClick: onOpen }}
    >
      {outcomes.length > 0 && (
        <ul className="mt-3 list-disc pl-5 font-secondary text-base text-[var(--g-ink-soft)]">
          {outcomes.map(outcome => (
            <li key={outcome}>{outcome}</li>
          ))}
        </ul>
      )}
    </CardFrame>
  );
};

/**
 * The CARE resource card (voice and tone §11.1): static, like the crisis
 * card, and private. PENDING CLINICAL REVIEW: copy in copy/safetyCopy.ts.
 */
export const ResourceCard: FC<{ language: string; lines: GuideCrisisLine[] }> = ({
  language,
  lines,
}) => {
  const copy = safetyCopyFor(language);
  return (
    <section
      data-testid="resource-card"
      aria-labelledby="guide-resource-title"
      className="rounded-2xl border border-[var(--g-line)] bg-[var(--g-card)] p-5"
    >
      <h3 id="guide-resource-title" className="g-title">
        {copy.resourceTitle}
      </h3>
      <p className="mt-1 font-secondary text-base text-[var(--g-ink-soft)]">{copy.resourceLine}</p>
      <ul className="mt-3 flex flex-col gap-2 font-primary text-[15px] text-[var(--g-ink)]">
        <li>{copy.resourceSupervisor}</li>
        {crisisLinesFor(lines).map(line => (
          <li key={`${line.name}-${line.phone}`}>
            {line.name}
            {line.hours ? ` · ${line.hours}` : ""} ·{" "}
            <a
              href={`tel:${line.phone.replace(/[^\d+]/g, "")}`}
              className="font-semibold underline underline-offset-2"
            >
              {line.phone}
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-3 font-primary text-sm text-[var(--g-ink-faint)]">{copy.resourcePrivacy}</p>
    </section>
  );
};

/**
 * The finale (M3, presence spec §6.3) isn't built yet. Until it is, the card
 * shows its title and the before/now pair if the server sent one, at rest.
 */
export const FinaleCard: FC<{ card: GuideCard }> = ({ card }) => {
  const { t } = useTranslation();
  const payload = payloadOf(card);
  const before = text(payload.before);
  const now = text(payload.now);
  return (
    <section
      data-testid="finale-card"
      className="rounded-2xl border border-[var(--g-line)] bg-[var(--g-card)] p-5"
    >
      <h3 className="g-title">{card.title || t("guide.finale.title")}</h3>
      {(before || now) && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {before && (
            <blockquote className="border-l-2 border-[var(--g-quote-rule)] pl-3 font-secondary italic">
              <span className="g-label block not-italic text-[var(--g-ink-faint)]">
                {t("guide.finale.before")}
              </span>
              {before}
            </blockquote>
          )}
          {now && (
            <blockquote className="border-l-2 border-[var(--g-quote-rule)] pl-3 font-secondary italic">
              <span className="g-label block not-italic text-[var(--g-ink-faint)]">
                {t("guide.finale.now")}
              </span>
              {now}
            </blockquote>
          )}
        </div>
      )}
    </section>
  );
};
