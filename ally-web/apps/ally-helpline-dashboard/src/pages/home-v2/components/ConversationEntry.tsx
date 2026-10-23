import { FunctionComponent } from "react";

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { ALLY_URL, ROUTES } from "@constants";
import { cn } from "@utils";

import { ConversationCard } from "./ConversationCards";
import { PRACTICE_CHOICES } from "../conversation";

import type { Entry, LinkTarget, PracticeChoice } from "../conversation";

/** The "A" of the Ally wordmark, on clay: clay marks what a machine wrote. */
export const AllyMark: FunctionComponent<{ className?: string }> = ({ className }) => (
  <span
    aria-hidden="true"
    className={cn(
      "flex size-9 flex-none items-center justify-center rounded-full bg-ai-500 text-white",
      className,
    )}
  >
    <svg width="18" height="17" viewBox="0 0 21 20" fill="none">
      <path
        d="M0.44 19.58L2.68 18.74L10.38 0.119999H11.22L19.2 19.16L20.6 19.58V20H17.24C16.2693 20 15.476 19.7853 14.86 19.356C14.244 18.908 13.7867 18.3293 13.488 17.62L12.06 14.26H5.368L3.52 18.74L5.62 19.58V20H0.44V19.58ZM5.648 13.56H11.78L8.7 6.196L5.648 13.56Z"
        fill="currentColor"
      />
    </svg>
  </span>
);

const LINK_TARGETS: Record<LinkTarget, { href: string; external: boolean }> = {
  partner: { href: ALLY_URL, external: true },
  team: { href: ALLY_URL, external: true },
  learn: { href: ROUTES.LEARN, external: false },
};

const linkClass =
  "text-md font-semibold text-primary-500 underline-offset-4 hover:text-primary-600 hover:underline";

/** Indent that lines a card or a follow-on line up with the text beside Ally's mark. */
const INDENT = "ml-12";

interface ConversationEntryProps {
  entry: Entry;
  /** Whether this Ally line starts a new run, so it carries the mark. */
  startsRun: boolean;
  onPick: (choice: PracticeChoice) => void;
}

export const ConversationEntry: FunctionComponent<ConversationEntryProps> = ({
  entry,
  startsRun,
  onPick,
}) => {
  const { t } = useTranslation();

  switch (entry.kind) {
    case "ally": {
      const link = entry.link ? LINK_TARGETS[entry.link.target] : null;
      return (
        <div className="flex items-start gap-3">
          {startsRun ? <AllyMark /> : <span aria-hidden="true" className="w-9 flex-none" />}
          <div className="flex min-w-0 flex-col gap-2 pt-1">
            <p
              className={cn(
                "m-0 text-xl leading-relaxed text-gray-900",
                entry.tone === "quiet" && "text-lg text-gray-600",
                entry.tone === "error" && "text-tone-alarm",
              )}
            >
              {startsRun && <span className="sr-only">{t("homeV2.speakers.ally")}: </span>}
              {t(`homeV2.answers.${entry.key}`, entry.values)}
            </p>
            {entry.link &&
              link &&
              (link.external ? (
                <a href={link.href} target="_blank" rel="noopener noreferrer" className={linkClass}>
                  {t(entry.link.key)} →
                </a>
              ) : (
                <Link to={link.href} className={linkClass}>
                  {t(entry.link.key)} →
                </Link>
              ))}
          </div>
        </div>
      );
    }

    case "user":
      return (
        <p className="m-0 max-w-[78%] self-end rounded-[18px] rounded-br-[4px] bg-primary-500 px-4 py-2.5 text-lg leading-relaxed text-white">
          <span className="sr-only">{t("homeV2.speakers.you")}: </span>
          {entry.key ? t(entry.key) : entry.text}
        </p>
      );

    case "client":
      return (
        <div className={cn(INDENT, "flex items-start gap-3")}>
          <span
            aria-hidden="true"
            className="flex size-8 flex-none items-center justify-center rounded-full bg-primary-200 font-secondary text-lg text-primary-700"
          >
            {t("homeV2.speakers.client").charAt(0)}
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs tracking-wide text-gray-600">
              {t("homeV2.speakers.client")}
            </span>
            <p className="m-0 rounded-[18px] rounded-tl-[4px] bg-primary-50 px-4 py-2.5 text-lg leading-relaxed">
              {t(entry.key)}
            </p>
          </div>
        </div>
      );

    case "choices":
      if (entry.answered) return null;
      return (
        <div
          role="group"
          aria-labelledby="home-v2-practice-prompt"
          className={cn(INDENT, "flex flex-col gap-2 sm:ml-[92px]")}
        >
          <span id="home-v2-practice-prompt" className="text-sm font-semibold text-gray-600">
            {t("homeV2.practice.prompt")}
          </span>
          {PRACTICE_CHOICES.map(choice => (
            <button
              key={choice}
              type="button"
              onClick={() => onPick(choice)}
              className="min-h-12 rounded-[14px] border-[1.5px] border-primary-200 bg-white px-4 py-3 text-left text-lg leading-relaxed text-primary-700 hover:border-primary-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
              {t(`homeV2.practice.choices.${choice}`)}
            </button>
          ))}
        </div>
      );

    case "feedback":
      return (
        <aside
          aria-label={t("homeV2.practice.feedback.title")}
          className={cn(
            INDENT,
            "flex flex-col gap-3 rounded-2xl border border-ai-200 bg-ai-50 p-5",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold uppercase tracking-wider text-ai-700">
              {t("homeV2.practice.feedback.title")}
            </span>
            <span className="rounded-full bg-ai-100 px-2.5 py-1 text-sm text-ai-800">
              {t(`homeV2.practice.feedback.${entry.choice}.tag`)}
            </span>
          </div>
          <p className="m-0 text-lg leading-relaxed text-ai-900">
            {t(`homeV2.practice.feedback.${entry.choice}.what`)}
          </p>
          <p className="m-0 text-lg leading-relaxed text-ai-900">
            <strong>{t("homeV2.practice.feedback.tryNext")}</strong>{" "}
            {t(`homeV2.practice.feedback.${entry.choice}.next`)}
          </p>
        </aside>
      );

    case "card":
      return (
        <div className={INDENT}>
          <ConversationCard card={entry.card} />
        </div>
      );

    default:
      return null;
  }
};
