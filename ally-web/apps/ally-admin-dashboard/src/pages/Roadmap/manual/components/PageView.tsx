import React, { useEffect, useMemo, useRef } from "react";

import { ArrowLeft, ArrowRight } from "@carbon/icons-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";

import { Button, OverflowMenu, OverflowMenuItem, SkeletonText, Tag } from "@ally-ui-mono/ui-shared";
import { useGetManualPageQuery } from "@api";
import { en } from "@constants";
import type { ManualPageDetail } from "@types";
import { formatRelativeTime } from "@utils";

import { MarkdownBody } from "./MarkdownBody";
import { SelectionMenu } from "./SelectionMenu";
import { ManualMessage } from "./StateViews";
import {
  fadeUpVariants,
  listStaggerDelay,
  motionTransition,
  useReducedMotionPreference,
} from "../../../../motion";
import { useManualData } from "../hooks/useManualData";
import { ManualSelection, useSelectionMenu } from "../hooks/useSelectionMenu";
import { siblingPager } from "../utils/tree";
import { extractHeadings, manualHref } from "../utils/wikilinks";

const t = () => en.productManual;

export const PageSkeleton: React.FC = () => (
  <div className="flex flex-col gap-4 py-2" aria-busy="true" aria-label={t().loading}>
    <SkeletonText width="40%" />
    <SkeletonText heading width="70%" />
    <SkeletonText width="85%" />
    <div className="mt-6">
      <SkeletonText paragraph lineCount={8} />
    </div>
  </div>
);

/** Updated · Checked against the code · Ships in next release · tags. Quiet, one line. */
export const PageMeta: React.FC<{ page: ManualPageDetail }> = ({ page }) => {
  const copy = t();
  const tags = [...page.roles, ...page.surfaces];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-typography-600">
      <span title={page.updatedAt}>{copy.updated(formatRelativeTime(page.updatedAt))}</span>
      <span aria-hidden>·</span>
      <span title={page.verifiedAt ?? undefined}>
        {page.verifiedAt ? copy.checked(formatRelativeTime(page.verifiedAt)) : copy.notChecked}
      </span>
      {page.releaseState === "next" && (
        <Tag type="blue" size="sm" className="!m-0">
          {copy.shipsNext}
        </Tag>
      )}
      {tags.map(tag => (
        <Tag key={tag} type="gray" size="sm" className="!m-0">
          {tag}
        </Tag>
      ))}
    </div>
  );
};

const OnThisPage: React.FC<{ body: string }> = ({ body }) => {
  const { bySlug } = useManualData();
  const headings = useMemo(
    () => extractHeadings(body, new Map([...bySlug.values()].map(page => [page.slug, page.title]))),
    [body, bySlug],
  );
  if (headings.length < 2) return null;
  return (
    <nav
      aria-label={t().onThisPage}
      className="sticky top-6 hidden max-h-[70vh] w-52 shrink-0 self-start overflow-y-auto 2xl:block"
    >
      <p className="m-0 mb-2 text-xs font-semibold uppercase tracking-wide text-typography-600">
        {t().onThisPage}
      </p>
      <ul className="m-0 flex list-none flex-col gap-1.5 border-l border-border-light p-0">
        {headings.map((heading, index) => (
          <li key={`${heading.id}-${index}`} className={heading.level === 3 ? "pl-6" : "pl-3"}>
            <a
              href={`#${heading.id}`}
              onClick={event => {
                const target = document.getElementById(heading.id);
                if (!target) return;
                event.preventDefault();
                target.scrollIntoView({ block: "start" });
              }}
              className="text-xs leading-snug text-typography-600 hover:text-typography-900"
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
};

const PageCard: React.FC<{ slug: string; title: string; summary?: string }> = ({
  slug,
  title,
  summary,
}) => (
  <Link
    to={manualHref(slug)}
    className="flex flex-col gap-1 border border-border-light bg-white p-3 transition-colors duration-100 hover:border-primary-500"
  >
    <span className="text-sm font-semibold text-typography-900">{title}</span>
    {summary && <span className="text-xs leading-relaxed text-typography-600">{summary}</span>}
  </Link>
);

export interface PageViewProps {
  slug: string;
  /** Ask about a selection, or start a draft from it (SPLIT mode opens). */
  onAskSelection: (selection: string, mode: "ask" | "draft") => void;
  onOpenChanges: (slug: string) => void;
  onSearch: () => void;
  /** Called once the page has loaded, for "recently read". */
  onLoaded?: (page: { slug: string; title: string }) => void;
  showContents?: boolean;
}

/**
 * One manual page: breadcrumb, title, summary, meta, the body, Related (backlinks and children),
 * then Previous / Next in its section. Content fades up in a short stagger when the page changes;
 * under reduced motion it crossfades.
 */
export const PageView: React.FC<PageViewProps> = ({
  slug,
  onAskSelection,
  onOpenChanges,
  onSearch,
  onLoaded,
  showContents = true,
}) => {
  const copy = t();
  const reduced = useReducedMotionPreference();
  const { pages } = useManualData();
  const {
    data: page,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useGetManualPageQuery(slug);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { selection, last, dismiss } = useSelectionMenu(bodyRef, slug);

  useEffect(() => {
    if (page && page.slug === slug) onLoaded?.({ slug: page.slug, title: page.title });
    // Only when the page itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.slug, slug]);

  const pager = useMemo(() => siblingPager(pages, slug), [pages, slug]);

  if (isLoading || (isFetching && page?.slug !== slug)) return <PageSkeleton />;
  const status = (error as { status?: number } | undefined)?.status;
  if (isError && status === 404) {
    return <ManualMessage title={copy.unknownPage} action={copy.search} onAction={onSearch} />;
  }
  if (isError || !page) {
    return (
      <ManualMessage title={copy.pageLoadFailed} action={copy.retry} onAction={() => refetch()} />
    );
  }

  const act = (mode: "ask" | "draft", source: ManualSelection | null) => {
    if (!source) return;
    dismiss();
    onAskSelection(source.text, mode);
  };
  const stagger = (index: number) => ({
    variants: fadeUpVariants(reduced, 6),
    initial: "initial" as const,
    animate: "animate" as const,
    transition: {
      ...motionTransition("moderate", "expressive", reduced),
      delay: listStaggerDelay(index * 2, reduced),
    },
  });
  // "Pages that link here": the backlinks the server computed from every page's [[links]].
  const related = page.backlinks;

  return (
    <div className="flex gap-10">
      <article key={page.slug} className="min-w-0 flex-1" aria-labelledby="manual-page-title">
        {page.breadcrumb.length > 0 && (
          <motion.nav aria-label={copy.breadcrumb} {...stagger(0)}>
            <ol className="m-0 flex list-none flex-wrap items-center gap-1 p-0 text-xs text-typography-600">
              {page.breadcrumb.map((crumb, index) => (
                <li key={crumb.slug} className="flex items-center gap-1">
                  {index > 0 && <span aria-hidden>/</span>}
                  <Link to={manualHref(crumb.slug)} className="hover:text-typography-900">
                    {crumb.title}
                  </Link>
                </li>
              ))}
            </ol>
          </motion.nav>
        )}
        <motion.header className="mt-3 flex items-start gap-3" {...stagger(1)}>
          <div className="min-w-0 flex-1">
            <h1
              id="manual-page-title"
              className="m-0 text-[2rem] font-semibold leading-tight text-typography-900"
            >
              {page.title}
            </h1>
            {page.summary && (
              <p className="m-0 mt-2 text-lg leading-relaxed text-typography-700">{page.summary}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1 pt-1">
            <Button kind="ghost" size="sm" onClick={() => onOpenChanges(page.slug)}>
              {copy.whatChanged}
            </Button>
            <OverflowMenu
              aria-label={copy.moreActions}
              iconDescription={copy.moreActions}
              flipped
              size="sm"
            >
              <OverflowMenuItem
                itemText={copy.askAboutSelection}
                disabled={!last}
                onClick={() => act("ask", last)}
              />
              <OverflowMenuItem
                itemText={copy.draftFromSelection}
                disabled={!last}
                onClick={() => act("draft", last)}
              />
            </OverflowMenu>
          </div>
        </motion.header>
        <motion.div className="mt-4" {...stagger(2)}>
          <PageMeta page={page} />
        </motion.div>
        <motion.div ref={bodyRef} className="manual-prose mt-8" {...stagger(3)}>
          <MarkdownBody body={page.body} />
        </motion.div>
        <SelectionMenu
          selection={selection}
          onAsk={() => act("ask", selection)}
          onDraft={() => act("draft", selection)}
          onClose={dismiss}
        />

        {(related.length > 0 || page.children.length > 0) && (
          <motion.section
            aria-labelledby="manual-related"
            className="mt-12 flex max-w-[68ch] flex-col gap-6 border-t border-border-light pt-6"
            {...stagger(4)}
          >
            <h2 id="manual-related" className="m-0 text-base font-semibold text-typography-900">
              {copy.related}
            </h2>
            {page.children.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="m-0 text-xs font-semibold text-typography-600">
                  {copy.inThisSection}
                </h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {page.children.map(child => (
                    <PageCard key={child.slug} {...child} />
                  ))}
                </div>
              </div>
            )}
            {related.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="m-0 text-xs font-semibold text-typography-600">{copy.backlinks}</h3>
                <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                  {related.map(link => (
                    <li key={link.slug}>
                      <Link
                        to={manualHref(link.slug)}
                        className="inline-flex rounded-full border border-border-light px-3 py-1 text-sm text-typography-800 hover:border-primary-500"
                      >
                        {link.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </motion.section>
        )}

        {(pager.previous || pager.next) && (
          <nav
            aria-label={copy.pagerLabel}
            className="mt-10 flex max-w-[68ch] items-stretch justify-between gap-3 border-t border-border-light pt-6"
          >
            {pager.previous ? (
              <Link
                to={manualHref(pager.previous.slug)}
                className="flex min-w-0 flex-1 flex-col gap-0.5 p-2 hover:bg-neutral-50"
              >
                <span className="flex items-center gap-1 text-xs text-typography-600">
                  <ArrowLeft size={12} aria-hidden /> {copy.previous}
                </span>
                <span className="truncate text-sm font-semibold text-typography-900">
                  {pager.previous.title}
                </span>
              </Link>
            ) : (
              <span className="flex-1" />
            )}
            {pager.next ? (
              <Link
                to={manualHref(pager.next.slug)}
                className="flex min-w-0 flex-1 flex-col items-end gap-0.5 p-2 text-right hover:bg-neutral-50"
              >
                <span className="flex items-center gap-1 text-xs text-typography-600">
                  {copy.next} <ArrowRight size={12} aria-hidden />
                </span>
                <span className="truncate text-sm font-semibold text-typography-900">
                  {pager.next.title}
                </span>
              </Link>
            ) : (
              <span className="flex-1" />
            )}
          </nav>
        )}
      </article>
      {showContents && <OnThisPage body={page.body} />}
    </div>
  );
};
