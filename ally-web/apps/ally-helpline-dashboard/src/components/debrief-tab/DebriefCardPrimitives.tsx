import { FC, ReactNode, createContext, useContext, useState } from "react";

import { ChevronDown, CircleDashed, Sprout, Star } from "lucide-react";
import { useTranslation } from "react-i18next";

import { DebriefSkillWord } from "@types";

import { useIsAnyBeingRead, useIsBeingRead } from "./ReadAloudControls";

export const SKILL_WORD_ICON: Record<DebriefSkillWord, ReactNode> = {
  strength: <Star aria-hidden="true" className="h-4 w-4 shrink-0 text-success-600" />,
  keep_practising: <Sprout aria-hidden="true" className="h-4 w-4 shrink-0 text-warning-700" />,
  didnt_come_up: (
    <CircleDashed aria-hidden="true" className="h-4 w-4 shrink-0 text-typography-600" />
  ),
};

/** PRD §6.3: each quote opens the transcript at the turn it came from. */
export const SeeMomentContext = createContext<((quote: string) => void) | null>(null);

export const Quote: FC<{ text: string }> = ({ text }) => {
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

/**
 * One card in the debrief: a list item with a heading. A [collapsible] card
 * starts closed and opens from its heading (or while read-aloud is reading
 * it), so a long debrief is easier to take in.
 */
export const Card: FC<{
  title: string;
  icon: ReactNode;
  tone?: "neutral" | "attention";
  children: ReactNode;
  testId?: string;
  /** The section read-aloud reads for this card, for its highlight. */
  readSection?: string;
  /** Sections inside this card that read-aloud may read: it opens while one is. */
  readSections?: string[];
  collapsible?: boolean;
}> = ({
  title,
  icon,
  tone = "neutral",
  children,
  testId,
  readSection,
  readSections,
  collapsible = false,
}) => {
  const reading = useIsBeingRead(readSection ?? "");
  const readingInside = useIsAnyBeingRead(readSections ?? []);
  const [open, setOpen] = useState(false);
  const shown = !collapsible || open || reading || readingInside;
  const bodyId = `${testId ?? title}-body`;
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
      <h3 className="font-primary text-base font-semibold text-typography-900">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={shown}
            aria-controls={bodyId}
            onClick={() => setOpen(!shown)}
            className="flex min-h-[44px] w-full items-center gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
          >
            {icon}
            <span className="flex-1">{title}</span>
            <ChevronDown
              aria-hidden="true"
              className={`h-4 w-4 transition-transform motion-reduce:transition-none ${shown ? "rotate-180" : ""}`}
            />
          </button>
        ) : (
          <span className="flex items-center gap-2">
            {icon}
            {title}
          </span>
        )}
      </h3>
      {shown && (
        <div id={bodyId} className="flex flex-col gap-3">
          {children}
        </div>
      )}
    </li>
  );
};

export const Body: FC<{ children: ReactNode }> = ({ children }) => (
  <p className="font-primary text-sm leading-relaxed text-typography-800">{children}</p>
);

export const Lead: FC<{ children: ReactNode }> = ({ children }) => (
  <h4 className="font-primary text-sm font-semibold text-typography-900">{children}</h4>
);

/** A card item that gets a ring while read-aloud is reading it. */
export const ReadableItem: FC<{ section: string; children: ReactNode }> = ({
  section,
  children,
}) => {
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
