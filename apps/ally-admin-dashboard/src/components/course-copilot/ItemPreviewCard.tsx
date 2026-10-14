import React, { useEffect, useRef, useState } from "react";

import { Launch } from "@icons";

import { ROUTES, en } from "@constants";
import type { CourseItemPreview, CourseOutlineItem } from "@types";
import { asAgentText, asAgentTextList } from "@utils";

import {
  asArray,
  asHttpUrl,
  asNumber,
  humanizeToken,
  summarizeCompletion,
} from "./courseCopilotFormat";
import { getItemTypeIcon, getItemTypeLabel } from "./courseItemMeta";
import { prefersReducedMotion } from "../../pages/Builder/builderMotion";

export interface ItemPreviewCardProps {
  item: CourseOutlineItem;
  /** This item was just changed by the copilot — highlight it briefly. */
  flash?: boolean;
  /**
   * Changes whenever a new batch of changed ids arrives (the parent's `flashItemIds` array).
   * Without it an item flashed twice in a row — still `flash` both times — would only
   * highlight the first time.
   */
  flashToken?: unknown;
  /** One line (type, title, size) instead of the full preview — used while the build is still writing. */
  compact?: boolean;
}

/** How long a changed item stays highlighted. Long enough to find it, short enough to be gone before the next edit. */
const FLASH_MS = 1600;

const Chip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="shrink-0 rounded-full bg-secondary-50 px-2 py-0.5 text-xs text-typography-900">
    {children}
  </span>
);

const Stat: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-xs text-typography-700">{children}</span>
);

const GeneratedBadge: React.FC = () => (
  <span className="shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-700">
    {en.courseCopilotPane.course.preview.generated}
  </span>
);

const text = (value: unknown): string => asAgentText(value).trim();

/**
 * Whether the card body already states the count the header's `size` ("820 words, 2
 * checks", "6 questions") would repeat. Shown twice, the same figures read as two
 * different facts; shown once, in the body, they sit next to the content they measure.
 */
const bodyStatesSize = (preview: CourseItemPreview | null | undefined): boolean => {
  if (!preview || typeof preview !== "object") return false;
  switch (preview.type) {
    case "ARTICLE":
      return asNumber(preview.wordCount) !== null;
    case "QUIZ":
      return asNumber(preview.questionCount) !== null;
    case "ANNOTATED_ARTIFACT":
      return asNumber(preview.unitCount) !== null;
    default:
      return false;
  }
};

/** The type-specific body of a card. Every field is read defensively: a preview is built server-side from content the agent wrote. */
const PreviewBody: React.FC<{ preview: CourseItemPreview | null | undefined }> = ({ preview }) => {
  const strings = en.courseCopilotPane.course.preview;
  if (!preview || typeof preview !== "object") return null;

  switch (preview.type) {
    case "ARTICLE": {
      const excerpt = text(preview.excerpt);
      const images = asArray<string>(preview.imageUrls).filter(
        url => typeof url === "string" && url,
      );
      const words = asNumber(preview.wordCount);
      const checks = asNumber(preview.questionCount);
      const resources = asNumber(preview.resourceCount);
      return (
        <div className="flex gap-3">
          {images[0] && (
            <div className="shrink-0 space-y-0.5">
              <img
                src={images[0]}
                alt=""
                loading="lazy"
                className="h-16 w-24 rounded border border-neutral-200 object-cover"
              />
              {images.length > 1 && <Stat>{strings.moreImages(images.length - 1)}</Stat>}
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            {excerpt && <p className="line-clamp-3 text-sm text-typography-800">{excerpt}</p>}
            <div className="flex flex-wrap gap-x-3">
              {words !== null && <Stat>{strings.words(words)}</Stat>}
              {checks !== null && checks > 0 && <Stat>{strings.checks(checks)}</Stat>}
              {resources !== null && resources > 0 && <Stat>{strings.resources(resources)}</Stat>}
            </div>
          </div>
        </div>
      );
    }

    case "QUIZ": {
      const questions = asNumber(preview.questionCount);
      const passScore = asNumber(preview.passScore);
      const sample = text(preview.sampleQuestion);
      const types = asAgentTextList(preview.questionTypes);
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {questions !== null && <Stat>{strings.questions(questions)}</Stat>}
            {passScore !== null && <Stat>{strings.passMark(passScore)}</Stat>}
            {types.map(type => (
              <Chip key={type}>{strings.questionTypes[type] ?? humanizeToken(type)}</Chip>
            ))}
          </div>
          {sample && (
            <p className="border-l-2 border-neutral-200 pl-2 text-sm italic text-typography-800">
              {sample}
            </p>
          )}
        </div>
      );
    }

    case "JOURNAL": {
      const prompts = asAgentTextList(preview.prompts);
      if (prompts.length === 0) return null;
      const shown = prompts.slice(0, 3);
      return (
        <div className="space-y-1">
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-typography-800">
            {shown.map((prompt, index) => (
              <li key={`${index}-${prompt}`}>{prompt}</li>
            ))}
          </ul>
          {prompts.length > shown.length && (
            <Stat>{strings.morePrompts(prompts.length - shown.length)}</Stat>
          )}
        </div>
      );
    }

    case "ANNOTATED_ARTIFACT": {
      const units = asNumber(preview.unitCount);
      const targets = asNumber(preview.targetCount);
      const labels = asAgentTextList(preview.labels);
      const intro = text(preview.intro);
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {units !== null && <Stat>{strings.lines(units)}</Stat>}
            {targets !== null && <Stat>{strings.targets(targets)}</Stat>}
            {labels.map(label => (
              <Chip key={label}>{label}</Chip>
            ))}
          </div>
          {intro && <p className="line-clamp-2 text-sm text-typography-800">{intro}</p>}
        </div>
      );
    }

    case "ROLEPLAY": {
      const scenarioTitle = text(preview.scenarioTitle);
      const scenarioId = asNumber(preview.scenarioId);
      const cover = text(preview.coverImageUrl);
      return (
        <div className="flex items-center gap-3">
          {cover && (
            <img
              src={cover}
              alt=""
              loading="lazy"
              className="h-12 w-12 shrink-0 rounded-full border border-neutral-200 object-cover"
            />
          )}
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="truncate text-sm text-typography-900" title={scenarioTitle || undefined}>
              {scenarioTitle || strings.roleplayNotLinked}
            </p>
            {scenarioId !== null && (
              <a
                href={ROUTES.EDIT_SIMULATION(scenarioId)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline"
              >
                {strings.openRoleplay}
                <Launch className="h-3 w-3" />
              </a>
            )}
          </div>
          {preview.generated && <GeneratedBadge />}
        </div>
      );
    }

    case "CASE": {
      const caseTitle = text(preview.caseTitle);
      const roleplays = asNumber(preview.roleplayCount);
      return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p
            className="min-w-0 truncate text-sm text-typography-900"
            title={caseTitle || undefined}
          >
            {caseTitle || strings.caseNotLinked}
          </p>
          {roleplays !== null && <Stat>{strings.roleplays(roleplays)}</Stat>}
          {preview.generated && <GeneratedBadge />}
        </div>
      );
    }

    case "GAME": {
      const key = text(preview.gameKey);
      const intro = text(preview.intro);
      return (
        <div className="space-y-1">
          {key && <Chip>{strings.gameNames[key] ?? humanizeToken(key)}</Chip>}
          {intro && <p className="line-clamp-2 text-sm text-typography-800">{intro}</p>}
        </div>
      );
    }

    case "VIDEO": {
      const source = text(preview.source);
      const url = text(preview.url);
      const link = asHttpUrl(url);
      if (!url && !source) return <Stat>{en.courseCopilotPane.blueprint.source.needsInput}</Stat>;
      return (
        <div className="flex min-w-0 items-center gap-2">
          {source && <Chip>{strings.videoSources[source] ?? humanizeToken(source)}</Chip>}
          {link ? (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              title={url}
              className="min-w-0 flex-1 truncate text-xs text-primary-600 hover:underline"
            >
              {url}
            </a>
          ) : (
            // Not an http(s) link, so it is shown but never made clickable.
            url && (
              <span className="min-w-0 flex-1 truncate text-xs text-typography-700">{url}</span>
            )
          )}
        </div>
      );
    }

    default:
      return null;
  }
};

/**
 * One item of the built course: what it is, how big, and enough of what the copilot wrote
 * to judge it without opening the editor. A card that has nothing to say in its body is
 * just its header — it never renders an empty frame.
 *
 * The highlight on a copilot edit moves nothing: under reduced motion the colour still
 * appears and disappears, only the fade is dropped (the information stays, the movement
 * goes).
 */
export const ItemPreviewCard: React.FC<ItemPreviewCardProps> = ({
  item,
  flash = false,
  flashToken,
  compact = false,
}) => {
  const [highlight, setHighlight] = useState(false);
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!flash) return undefined;
    setHighlight(true);
    // Brought into view because the point of the highlight is to show WHERE the copilot
    // just worked — an edit to item 14 means nothing if it is two screens below the fold.
    ref.current?.scrollIntoView?.({
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
    const timer = window.setTimeout(() => setHighlight(false), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash, flashToken]);

  const Icon = getItemTypeIcon(item.type);
  const title = text(item.title) || getItemTypeLabel(item.type);
  // Compact cards have no body, so the header's size is the only place the count appears.
  const size = !compact && bodyStatesSize(item.preview) ? "" : text(item.size);
  const completion = summarizeCompletion(item.completionCriteria);

  return (
    <li
      ref={ref}
      data-item-id={item.id}
      data-flash={highlight ? "true" : undefined}
      className={`rounded-md border p-3 ${
        prefersReducedMotion() ? "" : "transition-colors duration-700"
      } ${highlight ? "border-primary-300 bg-primary-50" : "border-neutral-200 bg-white"} ${
        compact ? "py-2" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary-50 px-2 py-0.5 text-xs text-typography-900">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          {getItemTypeLabel(item.type)}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium text-typography-900"
          title={title}
        >
          {title}
        </span>
        {size && <span className="shrink-0 text-xs text-typography-700">{size}</span>}
      </div>

      {!compact && completion.length > 0 && (
        <p className="mt-1 text-xs text-typography-700">{completion.join(" · ")}</p>
      )}

      {!compact && (
        <div className="mt-2 empty:hidden">
          <PreviewBody preview={item.preview} />
        </div>
      )}
    </li>
  );
};
