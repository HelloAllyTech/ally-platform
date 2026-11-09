import { FC } from "react";

import { useTranslation } from "react-i18next";

/** The numbered list on its own, for hosts that title it themselves. */
export const TakeawayList: FC<{ takeaways: string[] }> = ({ takeaways }) => (
  <ol className="flex flex-col gap-3">
    {takeaways.map((line, index) => (
      <li key={index} className="flex items-start gap-3 text-[0.95em] text-typography-900">
        <span
          aria-hidden
          className="mt-[0.1em] flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary-50 text-xs font-semibold text-primary-500"
        >
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 leading-relaxed">{line}</span>
      </li>
    ))}
  </ol>
);

interface ArticleTakeawaysProps {
  takeaways: string[];
  /** Anchor for the Magazine outline. */
  id?: string;
}

/** "Key takeaways" box closing a scrolling article, before its resources. */
export const ArticleTakeaways: FC<ArticleTakeawaysProps> = ({ takeaways, id }) => {
  const { t } = useTranslation();
  if (takeaways.length === 0) return null;
  return (
    <section
      id={id}
      data-testid="article-takeaways"
      className="mt-8 scroll-mt-6 rounded-xl border border-border-light bg-white p-5"
    >
      <h2 className="mb-4 text-[1.05em] font-semibold text-typography-900">
        {t("tracks2.article.takeawaysHeading")}
      </h2>
      <TakeawayList takeaways={takeaways} />
    </section>
  );
};
