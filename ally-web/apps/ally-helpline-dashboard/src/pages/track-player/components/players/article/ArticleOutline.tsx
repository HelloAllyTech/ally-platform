import { FC, RefObject, useEffect, useState } from "react";

import { useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";

import { ArticleOutlineEntry } from "../articleHtml";

interface ArticleOutlineProps {
  entries: ArticleOutlineEntry[];
  /** The scrolling container the headings live in. */
  scrollRef: RefObject<HTMLElement>;
}

/**
 * Magazine's "In this article" rail: the article's headings, the one being
 * read highlighted, each a jump to its heading. Shown from `lg` up only.
 */
export const ArticleOutline: FC<ArticleOutlineProps> = ({ entries, scrollRef }) => {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [activeId, setActiveId] = useState<string | null>(entries[0]?.id ?? null);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || entries.length === 0) return undefined;
    const targets = entries
      .map(entry => root.querySelector(`[id="${entry.id}"]`))
      .filter((el): el is Element => !!el);
    // A heading becomes current once it crosses into the top third.
    const observer = new IntersectionObserver(
      observed => {
        const visible = observed.filter(e => e.isIntersecting);
        if (visible.length === 0) return;
        const topmost = visible.reduce((a, b) =>
          a.boundingClientRect.top <= b.boundingClientRect.top ? a : b,
        );
        setActiveId(topmost.target.id);
      },
      { root, rootMargin: "0px 0px -66% 0px", threshold: 0 },
    );
    targets.forEach(target => observer.observe(target));
    return () => observer.disconnect();
  }, [entries, scrollRef]);

  const jumpTo = (id: string) => {
    const target = scrollRef.current?.querySelector(`[id="${id}"]`);
    target?.scrollIntoView?.({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    setActiveId(id);
  };

  if (entries.length === 0) return null;

  return (
    <nav
      aria-label={t("tracks2.article.inThisArticle")}
      data-testid="article-outline"
      className="sticky top-6 hidden self-start lg:block"
    >
      <p className="mb-3 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-typography-600">
        {t("tracks2.article.inThisArticle")}
      </p>
      <ul className="flex flex-col border-l border-border-light">
        {entries.map(entry => {
          const active = entry.id === activeId;
          return (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => jumpTo(entry.id)}
                aria-current={active ? "location" : undefined}
                className={`-ml-px block w-full border-l-2 py-1.5 pl-3 pr-2 text-left text-[13px] leading-snug transition-colors ${
                  active
                    ? "border-primary-500 font-semibold text-primary-500"
                    : "border-transparent text-typography-700 hover:text-typography-900"
                }`}
              >
                {entry.text}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
