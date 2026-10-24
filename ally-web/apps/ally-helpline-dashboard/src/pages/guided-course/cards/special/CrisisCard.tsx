import { FC, useEffect, useRef } from "react";

import { DEFAULT_CRISIS_LINES, safetyCopyFor, TELE_MANAS_TOLL_FREE } from "../../copy/safetyCopy";

import type { GuideCrisisLine } from "../../contract/wire";

export interface CrisisCardProps {
  /** The fixed message from `crisis.response`, already in a reviewed language. */
  message?: string | null;
  language: string;
  lines: GuideCrisisLine[];
  /** "I need help now" was chosen: the numbers are emphasised. */
  helpRequested?: boolean;
  onSafe?: () => void;
  onNeedHelp?: () => void;
  /** Reference mode (the Support chip): numbers only, no choices. */
  reference?: boolean;
}

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

/** The org's lines first, then the platform defaults; 112 is always there. */
export const crisisLinesFor = (lines: GuideCrisisLine[]): GuideCrisisLine[] => {
  const merged = lines.length ? [...lines] : [...DEFAULT_CRISIS_LINES];
  if (!merged.some(line => line.phone.replace(/\D/g, "") === "112")) {
    merged.push(DEFAULT_CRISIS_LINES[1]);
  }
  return merged;
};

/**
 * The one card that breaks the grammar on purpose (card grammar §5.4; plan
 * §6.3): pinned above the conversation, white ground, 2 px ink border, no
 * motion, not blue and not red. The fixed message comes first and takes
 * focus, so a screen reader reads it and a stray Enter can't press "I'm safe
 * right now". It needs no network.
 *
 * PENDING CLINICAL REVIEW: copy in copy/safetyCopy.ts.
 */
export const CrisisCard: FC<CrisisCardProps> = ({
  message,
  language,
  lines,
  helpRequested = false,
  onSafe,
  onNeedHelp,
  reference = false,
}) => {
  const copy = safetyCopyFor(language);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const shown = crisisLinesFor(lines);
  const hasTeleManas = shown.some(line => line.phone.replace(/\D/g, "") === "14416");

  useEffect(() => {
    if (!reference) messageRef.current?.focus();
  }, [reference]);

  return (
    <section
      aria-labelledby="guide-crisis-title"
      data-testid="crisis-card"
      className="rounded-2xl border-2 border-[var(--g-ink)] bg-[var(--g-card)] p-4 text-[var(--g-ink)] sm:p-5"
    >
      {message && !reference && (
        <p
          ref={messageRef}
          tabIndex={-1}
          className="g-prose mb-4 outline-none"
          data-testid="crisis-message"
        >
          {message}
        </p>
      )}
      <h2 id="guide-crisis-title" className="g-label text-[var(--g-ink)]">
        {copy.crisisTitle}
      </h2>
      <ul className="mt-3 grid grid-cols-2 gap-2">
        {shown.map(line => (
          <li key={`${line.name}-${line.phone}`}>
            <a
              href={telHref(line.phone)}
              aria-label={`${copy.call} ${line.name} ${line.phone}`}
              className={`flex min-h-[68px] flex-col justify-center rounded-[10px] bg-[var(--g-action)] px-3 py-2 text-[var(--g-on-action)] ${
                helpRequested ? "outline outline-[3px] outline-offset-2 outline-[var(--g-ink)]" : ""
              }`}
            >
              <span className="font-primary text-xs">
                {line.name}
                {line.hours ? ` · ${line.hours}` : ""}
              </span>
              <span className="font-primary text-[22px] font-semibold tabular-nums leading-7">
                ☎ {line.phone}
              </span>
            </a>
          </li>
        ))}
      </ul>
      {hasTeleManas && (
        <p className="mt-2 font-primary text-sm text-[var(--g-ink-soft)] select-text">
          {copy.tollFreeAlso("Tele-MANAS", TELE_MANAS_TOLL_FREE)}
        </p>
      )}

      {!reference && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onSafe}
            className="min-h-11 rounded-[10px] border-2 border-[var(--g-ink)] bg-transparent px-4 font-primary text-[15px] font-semibold"
          >
            {copy.safeNow}
          </button>
          <button
            type="button"
            onClick={onNeedHelp}
            aria-pressed={helpRequested}
            className="min-h-11 rounded-[10px] border-2 border-[var(--g-ink)] bg-transparent px-4 font-primary text-[15px] font-semibold"
          >
            {copy.needHelpNow}
          </button>
        </div>
      )}

      {helpRequested && !reference && (
        <div className="mt-4 flex flex-col gap-2" aria-live="polite">
          {copy.needHelpLines.map(line => (
            <p key={line} className="g-prose">
              {line}
            </p>
          ))}
        </div>
      )}

      <p className="mt-4 font-primary text-sm text-[var(--g-ink-faint)]">{copy.privacyFooter}</p>
    </section>
  );
};
