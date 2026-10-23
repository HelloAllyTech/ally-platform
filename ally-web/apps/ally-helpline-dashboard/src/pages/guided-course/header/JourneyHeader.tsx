import { FC, useEffect, useId, useRef, useState } from "react";

import { useTranslation } from "react-i18next";

import { GUIDANCE_LEVELS, GuidanceLevel } from "../contract/bootstrap";
import { AllyPresence, OrbState } from "../presence/AllyPresence";

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
  /** Hidden in the still atmosphere: nothing competes with the crisis card. */
  quiet: boolean;
}

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
  quiet,
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
        aria-label={t("guide.header.exit")}
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
        <p className="font-primary text-sm font-semibold text-[var(--g-ally-label)]">
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
            className="flex min-h-11 shrink-0 items-center gap-1 rounded-[10px] px-2 font-primary text-sm text-[var(--g-ink)] hover:bg-[var(--g-ground)]"
          >
            <span className="hidden sm:inline">{t("guide.dial.label")}:</span>
            <span className="font-semibold">{t(`guide.dial.${guidance}`)}</span>
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
          <button
            type="button"
            onClick={onClassic}
            className="mt-2 min-h-11 w-full rounded-[10px] px-2 text-left font-primary text-sm text-[var(--g-ink-soft)] underline underline-offset-2 sm:hidden"
          >
            {t("guide.header.classic")}
          </button>
        </div>
      )}
    </header>
  );
};
