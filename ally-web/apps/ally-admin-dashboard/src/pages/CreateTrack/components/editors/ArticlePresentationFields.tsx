import { FC, useRef } from "react";

import { toast } from "sonner";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import { TooltipIcon } from "@assets";
import { Button } from "@components";
import { ImageSourceField } from "@components/image-studio";
import { ButtonVariant } from "@components/types";
import {
  MAX_ARTICLE_COVER_ALT_LENGTH,
  MAX_ARTICLE_TAKEAWAY_LENGTH,
  MAX_ARTICLE_TAKEAWAYS,
} from "@constants";
import { ArticleCover, ArticleExperience, ImageContext } from "@types";

import { useTrackMediaUpload } from "../../useTrackMediaUpload";

const subClass = "text-xs text-typography-500";
const labelClass = "text-sm font-medium text-typography-800";
const inputClass =
  "w-full border border-border-light rounded-md px-3 py-2 text-sm outline-none focus:border-primary-400";

/** Same set the body's image button accepts. */
const COVER_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const HelpTip: FC<{ label: string }> = ({ label }) => (
  <Tooltip label={label} align="top">
    <button type="button" className="cursor-pointer inline-flex items-center">
      <TooltipIcon />
    </button>
  </Tooltip>
);

/* ---- Reading experience ------------------------------------------------- */

const EXPERIENCE_HELP =
  "How learners see this article. You can switch at any time; the text itself doesn't change.";

export const ARTICLE_EXPERIENCE_OPTIONS: {
  value: ArticleExperience;
  label: string;
  description: string;
}[] = [
  {
    value: ArticleExperience.CLASSIC,
    label: "Classic",
    description: "A simple page of text. Best for short notes and reference material.",
  },
  {
    value: ArticleExperience.MAGAZINE,
    label: "Magazine",
    description: "Cover photo, big headline and polished type. Best for longer reads.",
  },
  {
    value: ArticleExperience.CARDS,
    label: "Cards",
    description: "One section per swipe. Best for bite-sized learning on phones.",
  },
];

const line = (width: string) => <span className={`h-1 ${width} rounded-full bg-typography-300`} />;

/** A tiny wireframe of each experience, so the choice reads at a glance. */
const ExperienceThumbnail: FC<{ experience: ArticleExperience }> = ({ experience }) => (
  <span
    aria-hidden="true"
    className="flex h-14 w-20 shrink-0 overflow-hidden rounded-sm border border-border-light bg-white"
  >
    {experience === ArticleExperience.MAGAZINE && (
      <span className="flex w-full flex-col gap-1">
        <span className="h-5 w-full bg-primary-200" />
        <span className="flex flex-col gap-1 px-1.5">
          <span className="h-1.5 w-3/4 rounded-full bg-typography-500" />
          {line("w-full")}
          {line("w-4/5")}
        </span>
      </span>
    )}
    {experience === ArticleExperience.CARDS && (
      <span className="relative flex w-full items-center justify-center">
        <span className="absolute left-0.5 h-8 w-3 rounded-sm border border-border-light bg-secondary-50" />
        <span className="absolute right-0.5 h-8 w-3 rounded-sm border border-border-light bg-secondary-50" />
        <span className="relative flex h-11 w-9 flex-col gap-1 rounded-sm border border-typography-300 bg-white p-1 shadow-sm">
          <span className="h-1.5 w-4/5 rounded-full bg-typography-500" />
          {line("w-full")}
          {line("w-2/3")}
        </span>
      </span>
    )}
    {experience === ArticleExperience.CLASSIC && (
      <span className="flex w-full flex-col gap-1 p-1.5">
        <span className="h-1.5 w-2/3 rounded-full bg-typography-500" />
        {line("w-full")}
        {line("w-11/12")}
        {line("w-full")}
        {line("w-3/5")}
      </span>
    )}
  </span>
);

interface ArticleExperiencePickerProps {
  /** Form path, used to name the radio group and label it. */
  name: string;
  value?: ArticleExperience;
  onChange: (experience: ArticleExperience) => void;
  /** Whether the body has any `<h2>` — Cards splits on them. */
  hasCardBreaks: boolean;
}

export const ArticleExperiencePicker: FC<ArticleExperiencePickerProps> = ({
  name,
  value,
  onChange,
  hasCardBreaks,
}) => {
  const current = value ?? ArticleExperience.CLASSIC;
  return (
    <div className="rounded-md border border-border-light bg-secondary-50 px-4 py-3 flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span
          id={`${name}-label`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-typography-900"
        >
          Reading experience
          <HelpTip label={EXPERIENCE_HELP} />
        </span>
        <span className={subClass}>{EXPERIENCE_HELP}</span>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={`${name}-label`}
        className="grid grid-cols-1 gap-3 md:grid-cols-3"
      >
        {ARTICLE_EXPERIENCE_OPTIONS.map(option => {
          // An unrecognised stored value checks none, so any card can fix it.
          const checked = current === option.value;
          return (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-3 rounded-md border bg-white p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-400 ${
                checked
                  ? "border-primary-500 ring-1 ring-primary-500"
                  : "border-border-light hover:bg-secondary-50"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <ExperienceThumbnail experience={option.value} />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-typography-900">{option.label}</span>
                <span className={subClass}>{option.description}</span>
              </span>
            </label>
          );
        })}
      </div>
      {current === ArticleExperience.CARDS && !hasCardBreaks && (
        <p
          role="status"
          className="rounded-md border border-warning-300 bg-warning-50 px-3 py-2 text-xs text-warning-800"
        >
          Add H2 headings to split this article into cards. Right now it would be a single card.
        </p>
      )}
    </div>
  );
};

/* ---- Cover photo -------------------------------------------------------- */

interface ArticleCoverFieldProps {
  name: string;
  value?: ArticleCover;
  onChange: (cover: ArticleCover | undefined) => void;
  experience?: ArticleExperience;
  readingMinutes: number;
  /** Image Studio: this slot's id and what the article is about. Without them, upload only. */
  slotKey?: string;
  imageContext?: ImageContext;
}

export const ArticleCoverField: FC<ArticleCoverFieldProps> = ({
  name,
  value,
  onChange,
  experience,
  readingMinutes,
  slotKey,
  imageContext,
}) => {
  const { upload, isUploading } = useTrackMediaUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cover = value?.url ? value : undefined;
  const needsCover =
    !cover && (experience === ArticleExperience.MAGAZINE || experience === ArticleExperience.CARDS);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    if (!COVER_CONTENT_TYPES.includes(file.type)) {
      toast.error("Choose a JPG, PNG, WebP or GIF image.");
      return;
    }
    const url = await upload(file, "image");
    if (!url) return;
    // Replacing the photo keeps its description, so a better photo does not silently drop the alt text.
    onChange({ url, ...(cover?.alt ? { alt: cover.alt } : {}) });
  };

  const renderCover = () =>
    cover ? (
      <div className="flex flex-col gap-2 border border-border-light rounded-md p-3">
        <img
          src={cover.url}
          alt={cover.alt || "Cover photo preview"}
          className="h-32 w-full rounded-md object-cover"
        />
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-typography-700">
            Describe the photo for screen readers
          </span>
          <input
            id={`${name}.alt`}
            type="text"
            maxLength={MAX_ARTICLE_COVER_ALT_LENGTH}
            value={cover.alt ?? ""}
            onChange={event => onChange({ ...cover, alt: event.target.value })}
            placeholder="e.g. Two people talking on a park bench"
            className={inputClass}
          />
        </label>
        <div className="flex items-center gap-3">
          <Button
            variant={ButtonVariant.SECONDARY}
            className="!h-8 w-fit text-xs"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? "Uploading…" : "Replace"}
          </Button>
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="text-xs text-destructive-500 hover:text-destructive-600"
          >
            Remove
          </button>
        </div>
      </div>
    ) : (
      <Button
        variant={ButtonVariant.SECONDARY}
        className="!h-9 w-fit text-sm"
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
      >
        {isUploading ? "Uploading…" : "Upload cover photo"}
      </Button>
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="inline-flex items-center gap-1">
          <span className={labelClass}>Cover photo</span>
          <HelpTip label="Magazine and Cards open with this photo, full width. JPG, PNG, WebP or GIF; a wide landscape photo works best. Classic doesn't show it." />
        </span>
        <span className={subClass}>
          Shown at the top in Magazine and Cards. Optional in Classic.
        </span>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={COVER_CONTENT_TYPES.join(",")}
        className="hidden"
        onChange={handleFileChange}
        data-testid="article-cover-file-input"
      />
      {slotKey ? (
        <ImageSourceField
          slotKind="article_cover"
          slotKey={slotKey}
          context={imageContext}
          disabled={isUploading}
          onAccept={generated =>
            onChange({
              url: generated.url,
              ...(generated.altText || cover?.alt ? { alt: generated.altText || cover?.alt } : {}),
            })
          }
        >
          {renderCover()}
        </ImageSourceField>
      ) : (
        renderCover()
      )}
      {needsCover && (
        <p className="text-xs text-warning-800">
          Add a cover photo — Magazine and Cards open with it.
        </p>
      )}
      <p className={subClass} data-testid="article-reading-time">
        Reading time: about {readingMinutes} min (worked out from the text)
      </p>
    </div>
  );
};

/* ---- Key takeaways ------------------------------------------------------ */

interface ArticleTakeawaysFieldProps {
  name: string;
  value: string[];
  onChange: (takeaways: string[]) => void;
}

/**
 * Plain strings rather than a field array: a takeaway has no identity beyond
 * its text, and rows left blank are simply dropped when the course is saved.
 */
export const ArticleTakeawaysField: FC<ArticleTakeawaysFieldProps> = ({
  name,
  value,
  onChange,
}) => {
  const update = (index: number, text: string) =>
    onChange(value.map((takeaway, i) => (i === index ? text : takeaway)));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="inline-flex items-center gap-1">
          <span className={labelClass}>
            Key takeaways ({value.length}/{MAX_ARTICLE_TAKEAWAYS})
          </span>
          <HelpTip label="The few things a learner should remember. They're listed together after the article, before it's marked as read. Keep each to one short line; empty rows are left out when you save." />
        </span>
        <span className={subClass}>Up to 5 short points shown at the end of the article.</span>
      </div>
      {value.map((takeaway, index) => (
        <div key={index} className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              id={`${name}.${index}`}
              type="text"
              aria-label={`Takeaway ${index + 1}`}
              maxLength={MAX_ARTICLE_TAKEAWAY_LENGTH}
              value={takeaway}
              onChange={event => update(index, event.target.value)}
              placeholder="e.g. Listen first; advice can wait."
              className={`${inputClass} pr-16`}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-typography-400">
              {takeaway.length}/{MAX_ARTICLE_TAKEAWAY_LENGTH}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
            aria-label={`Remove takeaway ${index + 1}`}
            className="px-1.5 text-typography-500 hover:text-destructive-500"
          >
            ✕
          </button>
        </div>
      ))}
      {value.length < MAX_ARTICLE_TAKEAWAYS && (
        <button
          type="button"
          onClick={() => onChange([...value, ""])}
          className="self-start text-sm font-medium text-primary-500 hover:text-primary-600"
        >
          + Add takeaway
        </button>
      )}
    </div>
  );
};
