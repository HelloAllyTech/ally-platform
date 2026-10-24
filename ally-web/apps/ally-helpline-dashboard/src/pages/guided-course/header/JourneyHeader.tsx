import { FC, useEffect, useId, useRef, useState } from "react";

import { useTranslation } from "react-i18next";

import { GUIDANCE_LEVELS, GuidanceLevel } from "../contract/bootstrap";
import { AllyPresence, OrbState } from "../presence/AllyPresence";
import { SHELF_UTILITIES, ShelfUtility } from "../shelf/shelfParts";

/**
 * The guidance dial (plan §5.7): Lead me · Walk with me · I'll drive. It sets
 * how much Ally says, how readily Ally steers and how often Ally offers
 * optional practice, all at once. An explicit, clearly labelled autonomy
 * control builds trust (Stacks: "Graphical Agent Interface Design
 * Constraints"; the autonomy slider).
 */
export const GuidanceDial: FC<{
  value: GuidanceLevel;
  onChange: (level: GuidanceLevel) => void;
}> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-1" data-testid="guidance-dial">
      <legend className="g-label mb-1 text-[var(--g-ink-faint)]">{t("guide.dial.label")}</legend>
      {GUIDANCE_LEVELS.map(level => (
        <label
          key={level}
          className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-[10px] px-2 py-2 ${
            value === level ? "bg-[var(--g-learner-bubble)]" : "hover:bg-[var(--g-ground)]"
          }`}
        >
          <input
            type="radio"
            name={name}
            value={level}
            checked={value === level}
            onChange={() => onChange(level)}
            className="mt-1 accent-[var(--g-progress)]"
          />
          <span className="flex flex-col">
            <span className="font-primary text-[15px] font-semibold text-[var(--g-ink)]">
              {t(`guide.dial.${level}`)}
            </span>
            <span className="font-primary text-sm text-[var(--g-ink-soft)]">
              {t(`guide.dial.${level}Hint`)}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
};

export interface JourneyHeaderProps {
  courseTitle: string;
  orbState: OrbState;
  guidance: GuidanceLevel;
  onGuidanceChange: (level: GuidanceLevel) => void;
  /** Shown once the learner has been in CARE or a crisis: the support numbers, one tap away. */
  showSupport: boolean;
  onSupport: () => void;
  onClassic: () => void;
  onExit: () => void;
  /** What the back button says (a visitor goes back to the course page, not their courses). */
  exitLabel?: string;
  /** Hidden in the still atmosphere: nothing competes with the crisis card. */
  quiet: boolean;
  /** Languages the course is published in; the choice is offered when there are two or more. */
  languages?: string[];
  language?: string | null;
  onLanguageChange?: (languageCode: string) => void;
  /** A visitor can sign in from the menu at any time. */
  onSignIn?: () => void;
  /** Notebook, memory and preferences in the Shelf (signed-in learners). */
  onOpenUtility?: (utility: ShelfUtility) => void;
}

/** A language's own name ("हिन्दी"), so each option reads to the person who needs it. */
export const languageEndonym = (code: string): string => {
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code);
    return name ? name.charAt(0).toLocaleUpperCase(code) + name.slice(1) : code;
  } catch {
    return code;
  }
};

const CourseLanguage: FC<{
  languages: string[];
  value: string | null;
  onChange: (code: string) => void;
}> = ({ languages, value, onChange }) => {
  const { t } = useTranslation();
  const current = value?.split("-")[0] ?? null;
  return (
    <fieldset className="mt-3 border-t border-[var(--g-line)] pt-3" data-testid="course-language">
      <legend className="g-label mb-2 text-[var(--g-ink-soft)]">
        {t("guide.header.language")}
      </legend>
      <div className="flex flex-wrap gap-2">
        {languages.map(code => {
          const selected = code === value || code === current;
          return (
            <button
              key={code}
              type="button"
              lang={code}
              aria-pressed={selected}
              onClick={() => !selected && onChange(code)}
              className={`min-h-11 rounded-lg border px-3 font-primary text-sm ${
                selected
                  ? "border-[var(--g-ink)] font-semibold text-[var(--g-ink)]"
                  : "border-[var(--g-line)] text-[var(--g-ink-soft)] hover:border-[var(--g-ink-faint)]"
              }`}
            >
              {languageEndonym(code)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
};

/**
 * Ally's presence, the AI disclosure, and the learner's controls. The orb
 * here always carries Ally's current state (presence spec §3.3).
 */
export const JourneyHeader: FC<JourneyHeaderProps> = ({
  courseTitle,
  orbState,
  guidance,
  onGuidanceChange,
  showSupport,
  onSupport,
  onClassic,
  onExit,
  exitLabel,
  quiet,
  languages = [],
  language = null,
  onLanguageChange,
  onSignIn,
  onOpenUtility,
}) => {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointer = (event: PointerEvent) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !buttonRef.current?.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-2 border-b border-[var(--g-line)] bg-[var(--g-rail)] px-2 sm:px-4">
      <button
        type="button"
        onClick={onExit}
        aria-label={exitLabel ?? t("guide.header.exit")}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-[var(--g-ink-soft)] hover:bg-[var(--g-ground)]"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            d="M10 3.5L5.5 8l4.5 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <AllyPresence state={orbState} size={32} label={t(`guide.presence.label.${orbState}`)} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-primary text-sm font-semibold text-[var(--g-ally-label)]">
          {t("guide.header.disclosure")}
        </p>
        <p className="truncate font-primary text-xs text-[var(--g-rail-meta)]">{courseTitle}</p>
      </div>

      {showSupport && (
        <button
          type="button"
          onClick={onSupport}
          data-testid="support-chip"
          className="min-h-9 shrink-0 rounded-lg border border-[var(--g-ink)] px-3 font-primary text-sm font-semibold text-[var(--g-ink)] max-md:min-h-11"
        >
          {t("guide.header.support")}
        </button>
      )}

      {!quiet && (
        <>
          <button
            type="button"
            onClick={onClassic}
            className="hidden min-h-9 shrink-0 px-2 font-primary text-sm text-[var(--g-ink-soft)] underline underline-offset-2 sm:block"
          >
            {t("guide.header.classic")}
          </button>
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setMenuOpen(open => !open)}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label={`${t("guide.dial.label")}: ${t(`guide.dial.${guidance}`)}`}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-[10px] px-2 font-primary text-sm text-[var(--g-ink)] hover:bg-[var(--g-ground)]"
          >
            {/* On a narrow phone the dial is an icon, so the AI disclosure keeps its room. */}
            <svg
              viewBox="0 0 16 16"
              width="16"
              height="16"
              aria-hidden="true"
              className="sm:hidden"
            >
              <path
                d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <circle cx="5" cy="4.5" r="1.4" fill="currentColor" />
              <circle cx="10.5" cy="8" r="1.4" fill="currentColor" />
              <circle cx="7" cy="11.5" r="1.4" fill="currentColor" />
            </svg>
            <span className="hidden sm:inline">{t("guide.dial.label")}:</span>
            <span className="hidden font-semibold sm:inline">{t(`guide.dial.${guidance}`)}</span>
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        </>
      )}

      {menuOpen && !quiet && (
        <div
          id={menuId}
          ref={menuRef}
          className="absolute right-2 top-14 z-30 w-[min(320px,calc(100vw-16px))] rounded-2xl border border-[var(--g-line)] bg-[var(--g-card)] p-3 shadow-lg"
        >
          <GuidanceDial
            value={guidance}
            onChange={level => {
              onGuidanceChange(level);
              setMenuOpen(false);
              buttonRef.current?.focus();
            }}
          />
          {onOpenUtility && (
            <nav
              aria-label={t("guide.shelf.menu")}
              className="mt-3 flex flex-col border-t border-[var(--g-line)] pt-2"
            >
              {SHELF_UTILITIES.map(utility => (
                <button
                  key={utility}
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenUtility(utility);
                  }}
                  className="min-h-11 w-full rounded-[10px] px-2 text-left font-primary text-[15px] text-[var(--g-ink)] hover:bg-[var(--g-ground)]"
                >
                  {t(`guide.shelf.${utility}`)}
                </button>
              ))}
            </nav>
          )}
          {onLanguageChange && languages.length >= 2 && (
            <CourseLanguage
              languages={languages}
              value={language}
              onChange={code => {
                setMenuOpen(false);
                onLanguageChange(code);
              }}
            />
          )}
          <button
            type="button"
            onClick={onClassic}
            className="mt-2 min-h-11 w-full rounded-[10px] px-2 text-left font-primary text-sm text-[var(--g-ink-soft)] underline underline-offset-2 sm:hidden"
          >
            {t("guide.header.classic")}
          </button>
          {onSignIn && (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onSignIn();
              }}
              className="mt-2 min-h-11 w-full rounded-[10px] px-2 text-left font-primary text-sm font-semibold text-[var(--g-ink)] underline underline-offset-2"
            >
              {t("guide.header.signIn")}
            </button>
          )}
        </div>
      )}
    </header>
  );
};
