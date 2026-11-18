import { FC } from "react";

import { useTranslation } from "react-i18next";

import { ArticleCover } from "@types";

interface ArticleMagazineHeaderProps {
  cover: ArticleCover | null;
  kicker: string;
  title: string;
  description: string | null;
  minutes: number;
  questionCount: number;
}

/**
 * Magazine hero: the cover full-bleed, then a headline block lifted over its
 * lower edge — kicker, title, dek and a reading-time / quick-check meta row.
 * Without a cover there is no photo band, only the headline.
 */
export const ArticleMagazineHeader: FC<ArticleMagazineHeaderProps> = ({
  cover,
  kicker,
  title,
  description,
  minutes,
  questionCount,
}) => {
  const { t } = useTranslation();
  return (
    <header data-testid="article-magazine-header">
      {cover && (
        <div className="h-[260px] w-full overflow-hidden bg-neutral-100 md:h-[300px]">
          <img
            src={cover.url}
            alt={cover.alt ?? ""}
            className="h-full w-full object-cover"
            data-testid="article-cover"
          />
        </div>
      )}
      <div
        className={`relative mx-auto max-w-[760px] bg-white px-5 pt-6 sm:px-8 md:px-10 ${
          cover ? "-mt-6 rounded-t-[20px] md:-mt-[70px] md:pt-9" : "md:pt-9"
        }`}
      >
        <div className="border-b border-border-light pb-5">
          {kicker && (
            <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-primary-500">
              {kicker}
            </p>
          )}
          <h1 className="text-[26px] font-bold leading-[1.15] text-typography-900 md:text-[40px] md:leading-[1.1]">
            {title}
          </h1>
          {description && (
            <p className="mt-3 text-[17px] italic leading-snug text-typography-600 md:text-[19px]">
              {description}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-typography-700">
            <span className="rounded-full bg-primary-50 px-3 py-1 font-medium text-primary-700">
              {t("tracks2.article.minRead", { minutes })}
            </span>
            {questionCount > 0 && (
              <span className="rounded-full border border-border-light px-3 py-1 font-medium">
                {t("tracks2.article.quickChecks", { count: questionCount })}
              </span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
