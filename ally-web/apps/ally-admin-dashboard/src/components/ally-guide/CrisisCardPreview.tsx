import React from "react";

import { en } from "@constants";
import { AllyGuideSupportLine } from "@types";

import { hasTeleManas, resolvePreviewLines, TELE_MANAS_TOLL_FREE } from "./crisisPreview";

interface CrisisCardPreviewProps {
  /** The message as typed, or "" when this language has none yet. */
  message: string;
  language: string;
  /** The organisation's lines by language, as currently drafted; undefined for the platform preview. */
  supportLines?: Partial<Record<string, AllyGuideSupportLine[]>>;
}

/**
 * What a learner in crisis would see: the fixed message, then the card with the support lines.
 *
 * It follows the learner card's own look on purpose (white ground, a heavy dark border, neither
 * blue nor red, no motion) so the Ally team judges the real thing, and the lines are chosen by the
 * server's rules (see crisisPreview.ts). The two choice buttons are drawn but inert: nothing here
 * can reach a learner.
 */
export const CrisisCardPreview: React.FC<CrisisCardPreviewProps> = ({
  message,
  language,
  supportLines,
}) => {
  const strings = en.allyConsole.crisisPreview;
  const { lines, source } = resolvePreviewLines(supportLines, language);
  const trimmed = message.trim();
  const sourceNote =
    supportLines === undefined
      ? null
      : source === "org"
        ? strings.linesFromOrg
        : source === "english"
          ? strings.linesFromEnglish
          : strings.linesDefault;

  return (
    <div data-testid="crisis-card-preview">
      <p className="mb-2 text-xs tracking-wide text-typography-700">{strings.label}</p>
      <section
        aria-label={strings.label}
        className="border-2 border-typography-900 bg-white p-4 text-typography-900"
      >
        {trimmed ? (
          <p
            className="mb-4 whitespace-pre-wrap break-words text-base"
            data-testid="crisis-preview-message"
          >
            {trimmed}
          </p>
        ) : (
          <p
            className="mb-4 text-sm italic text-typography-700"
            data-testid="crisis-preview-missing"
          >
            {strings.messageMissing}
          </p>
        )}
        <h4 className="text-sm font-semibold">{strings.title}</h4>
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {lines.map(line => (
            <li
              key={`${line.name}-${line.phone}`}
              className="flex min-h-[64px] flex-col justify-center bg-typography-900 px-3 py-2 text-white"
              data-testid="crisis-preview-line"
            >
              <span className="text-xs">
                {line.name}
                {line.hours ? ` · ${line.hours}` : ""}
              </span>
              <span className="text-xl font-semibold tabular-nums">{line.phone}</span>
            </li>
          ))}
        </ul>
        {hasTeleManas(lines) && (
          <p className="mt-2 text-xs text-typography-700">
            Tele-MANAS is also on {TELE_MANAS_TOLL_FREE}.
          </p>
        )}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row" aria-hidden="true">
          <span className="inline-flex min-h-10 items-center justify-center border-2 border-typography-900 px-4 text-sm font-semibold">
            {strings.safeNow}
          </span>
          <span className="inline-flex min-h-10 items-center justify-center border-2 border-typography-900 px-4 text-sm font-semibold">
            {strings.needHelpNow}
          </span>
        </div>
        <p className="mt-4 text-xs text-typography-700">{strings.privacy}</p>
      </section>
      <p className="mt-2 text-xs text-typography-700">
        {strings.note} {strings.buttonsInert}
        {sourceNote ? ` ${sourceNote}` : ""}
      </p>
    </div>
  );
};
