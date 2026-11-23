import { createContext, useContext, useEffect, useRef, useState } from "react";

// By path: the bot page imports only self-contained modules (see eslint.config.mjs).
import { Orb } from "../../components/v2/core/Orb";
import { initials } from "../theme";

import type { BotPageCopy } from "../copy";
import type { AnswerFeedback, BotPageBranding, PublicCitation, PublicConfirmation } from "../types";

/**
 * Whether a screen's heading takes focus when it appears. Off in the dashboard's live preview, so
 * the preview never pulls focus away from the form the owner is typing in.
 */
export const FocusHeadings = createContext(true);

/** A screen's heading, focused when the screen appears so screen readers announce it. */
export function ScreenHeading({
  children,
  className = "",
  id,
}: {
  children: string;
  className?: string;
  id?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  const focus = useContext(FocusHeadings);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <h1 ref={ref} id={id} tabIndex={-1} className={`ally-display bp-heading ${className}`}>
      {children}
    </h1>
  );
}

/** The page's logo, or (without one) the assistant's initials in the brand colour. */
export function LogoMark({ branding }: { branding: BotPageBranding }) {
  const logo = branding.look?.logo;
  if (logo || branding.logoUrl) {
    return (
      <img
        src={logo?.src ?? branding.logoUrl ?? ""}
        srcSet={logo?.srcset || undefined}
        sizes="72px"
        alt=""
      />
    );
  }
  return (
    <span className="bp-initials" aria-hidden="true">
      {initials(branding.assistantName)}
    </span>
  );
}

/** The chat's avatar: the orb in the brand colour (stage 7: no owner picture). */
export function Avatar({ size = 40 }: { branding?: BotPageBranding; size?: number }) {
  return <Orb size={size} />;
}

/**
 * The bar at the top of every screen after the cover: the orb (or the owner's picture), the
 * page's name and a status line.
 */
export function PageHeader({
  branding,
  subtitle,
  children,
}: {
  branding: BotPageBranding;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="bp-header">
      <Avatar branding={branding} />
      <div className="bp-header__text">
        <p className="bp-header__name">{branding.assistantName || branding.title}</p>
        {subtitle && (
          <p className="bp-header__status" aria-live="polite">
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </header>
  );
}

export function TypingDots({ label }: { label: string }) {
  return (
    <span className="bp-dots" role="img" aria-label={label}>
      <span />
      <span />
      <span />
    </span>
  );
}

const DocIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M14 3H6v18h12V7z" />
    <path d="M14 3v4h4" />
  </svg>
);

/** Where an answer came from, once, as chips under it. */
export function Sources({ citations, copy }: { citations: PublicCitation[]; copy: BotPageCopy }) {
  if (!citations.length) return null;
  return (
    <div>
      <p className="ally-sr-only">{copy.chat.sources}</p>
      <ul className="bp-sources">
        {citations.map(c => (
          <li key={c.title}>
            {c.url ? (
              <a className="bp-source" href={c.url} target="_blank" rel="noopener noreferrer">
                <DocIcon />
                {c.title}
              </a>
            ) : (
              <span className="bp-source">
                <DocIcon />
                {c.title}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const REASONS = ["wrong_info", "not_answered", "other"] as const;

/**
 * "Was this helpful?" under one answer (chunk Q2a): thumbs up or down, changeable. A thumbs down
 * asks "What was wrong?" (three reasons and an optional note, or Skip), then thanks them.
 */
export function Feedback({
  copy,
  onRate,
}: {
  copy: BotPageCopy;
  onRate(feedback: AnswerFeedback): void;
}) {
  const t = copy.chat.feedback;
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState<AnswerFeedback["reason"]>();
  const [note, setNote] = useState("");
  const [thanked, setThanked] = useState(false);

  const rate = (next: "up" | "down") => {
    setRating(next);
    setThanked(false);
    if (next === "up") {
      setAsking(false);
      onRate({ rating: "up" });
      setThanked(true);
    } else {
      onRate({ rating: "down" });
      setAsking(true);
    }
  };

  const finish = (send: boolean) => {
    if (send && (reason || note.trim())) {
      onRate({ rating: "down", reason, note: note.trim() || undefined });
    }
    setAsking(false);
    setThanked(true);
  };

  return (
    <div className="bp-feedback" data-testid="answer-feedback">
      <div className="bp-feedback__row">
        <span className="bp-feedback__question">{t.question}</span>
        <button
          type="button"
          className="bp-feedback__thumb"
          aria-label={t.up}
          aria-pressed={rating === "up"}
          onClick={() => rate("up")}
        >
          <span aria-hidden="true">👍</span>
        </button>
        <button
          type="button"
          className="bp-feedback__thumb"
          aria-label={t.down}
          aria-pressed={rating === "down"}
          onClick={() => rate("down")}
        >
          <span aria-hidden="true">👎</span>
        </button>
      </div>
      {asking && (
        <div className="bp-feedback__form" role="group" aria-label={t.whatWrong}>
          <p className="bp-feedback__question">{t.whatWrong}</p>
          <div className="bp-feedback__reasons">
            {REASONS.map(id => (
              <button
                key={id}
                type="button"
                className="bp-pill"
                aria-pressed={reason === id}
                onClick={() => setReason(id)}
              >
                {t.reasons[id]}
              </button>
            ))}
          </div>
          <input
            className="bp-feedback__note"
            aria-label={t.notePlaceholder}
            placeholder={t.notePlaceholder}
            maxLength={300}
            value={note}
            onChange={event => setNote(event.target.value)}
          />
          <div className="bp-feedback__actions">
            <button type="button" className="bp-pill" onClick={() => finish(true)}>
              {t.send}
            </button>
            <button type="button" className="bp-feedback__skip" onClick={() => finish(false)}>
              {t.skip}
            </button>
          </div>
        </div>
      )}
      {thanked && (
        <p className="bp-feedback__thanks" role="status">
          {t.thanks}
        </p>
      )}
    </div>
  );
}

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      type="button"
      {...rest}
      className={`ally-btn ally-btn--primary ally-press ${className}`}
    />
  );
}

export function TextButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return <button type="button" {...rest} className={`ally-btn ally-btn--ghost ${className}`} />;
}

/** An error the visitor can read, announced as it appears. */
export function ErrorText({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <p role="alert" className="bp-error">
      {children}
    </p>
  );
}

/** Stage 7: only "Powered by"; the footer link is retired. */
export function Footer({ copy }: { branding?: BotPageBranding; copy: BotPageCopy }) {
  return (
    <footer className="bp-footer">
      <span>{copy.poweredBy}</span>
    </footer>
  );
}

/** The step the assistant is on (chunk 6b): one calm line with a small moving mark. */
export function StepLine({ text }: { text: string }) {
  return (
    <span className="bp-step" data-testid="live-step" aria-hidden="true">
      <span className="bp-step__mark" aria-hidden="true" />
      <span>{text}</span>
    </span>
  );
}

const CheckIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    aria-hidden="true"
  >
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

/**
 * What the assistant did for a reply (chunk 6b): one quiet line ("Checked free times · Booked Thu
 * 19 Nov, 11:00") that opens to the list of steps.
 */
export function StepsDone({ lines, copy }: { lines: string[]; copy: BotPageCopy }) {
  const [open, setOpen] = useState(false);
  if (!lines.length) return null;
  return (
    <div className="bp-done" data-testid="steps-done">
      <button
        type="button"
        className="bp-done__toggle"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span className="ally-sr-only">{open ? copy.steps.hide : copy.steps.show}: </span>
        <span aria-hidden={open || undefined}>{lines.join(" · ")}</span>
      </button>
      {open && (
        <ul className="bp-done__list">
          {lines.map(text => (
            <li key={text}>
              <CheckIcon />
              {text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A booking or change made in a reply (chunk 6b), from the stored record. */
export function ConfirmationCard({
  confirmation,
  copy,
  when,
}: {
  confirmation: PublicConfirmation;
  copy: BotPageCopy;
  when: string;
}) {
  return (
    <section className="bp-card" data-testid="confirmation-card" aria-label={confirmation.list}>
      <p className="bp-card__what" data-action={confirmation.action}>
        <CheckIcon />
        {confirmation.headline
          ? copy.steps.headline[confirmation.headline]
          : copy.steps.card[confirmation.action]}{" "}
        · {confirmation.list}
      </p>
      <p className="bp-card__when">{when}</p>
      {confirmation.details.length > 0 && (
        <dl className="bp-card__details">
          {confirmation.details.map(d => (
            <div key={d.label}>
              <dt>{d.label}</dt>
              <dd>{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/** The fixed "an AI and people may read this chat" notice and the pack's disclaimer (always shown, never dismissed). */
export function SafetyNotice({
  notice,
  disclaimer,
  label,
}: {
  notice?: string | null;
  disclaimer?: string | null;
  label: string;
}) {
  if (!notice?.trim() && !disclaimer?.trim()) return null;
  return (
    <section className="bp-safety" aria-label={label} data-testid="bp-safety-notice">
      {notice?.trim() && <p className="bp-safety__notice">{notice}</p>}
      {disclaimer?.trim() && <p className="bp-safety__disclaimer">{disclaimer}</p>}
    </section>
  );
}
