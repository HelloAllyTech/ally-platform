import { FC } from "react";

import { useTranslation } from "react-i18next";

import { ArrowRight } from "@assets";
import { ArticleResource } from "@types";

interface ArticleResourceListProps {
  resources: ArticleResource[];
  onOpen: (resource: ArticleResource) => void;
  /** Drop the top rule and spacing (the Cards end card has its own frame). */
  bare?: boolean;
}

/** The curated links after an article. Supplementary; never gates completion. */
export const ArticleResourceList: FC<ArticleResourceListProps> = ({
  resources,
  onOpen,
  bare = false,
}) => {
  const { t } = useTranslation();
  return (
    <div className={bare ? "" : "mt-8 border-t border-border-light pt-6"}>
      <h2 className="mb-3 text-sm font-semibold text-typography-900">
        {t("tracks2.article.resourcesHeading")}
      </h2>
      <div className="flex flex-col gap-2">
        {resources.map(resource => (
          <button
            key={resource.id}
            type="button"
            onClick={() => onOpen(resource)}
            className="flex items-center justify-between gap-2 rounded-lg border border-border-light px-3 py-2 text-left text-sm font-medium text-primary-500 transition-colors hover:bg-background-secondary"
          >
            <span className="truncate">{resource.title}</span>
            <span className="flex-shrink-0">
              <ArrowRight />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
