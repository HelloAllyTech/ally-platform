import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Book } from "@icons";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  Button,
  InlineNotification,
  SidePanel,
  SkeletonText,
  Tooltip,
} from "@ally-ui-mono/ui-shared";
import { en } from "@constants";

/**
 * The Core Concepts page of the Developer Wiki, shown view-only in a side panel from the
 * Roadmap's header. It is fetched from the published wiki on every open, so the panel always
 * shows the page as it is on `master` — never a copy baked into this build.
 */
export const CONCEPTS_WIKI_ORIGIN = "https://tech.helloally.ai";
export const CONCEPTS_PAGE_PATH = "/wiki/platform/concepts.md";
export const CONCEPTS_RAW_URL = `${CONCEPTS_WIKI_ORIGIN}${CONCEPTS_PAGE_PATH}`;
export const CONCEPTS_WIKI_URL = `${CONCEPTS_WIKI_ORIGIN}/#${CONCEPTS_PAGE_PATH}`;

const FRONTMATTER = /^---\n[\s\S]*?\n---\n/;
const CARD_MARKER = /^### (.+)\n<!--\s*concept:\s*([a-z0-9-]+)\s*-->$/gm;
const CARD_FIELD = /\n(\*\*[A-Z][^*\n]*:\*\*)/g;

export interface PreparedConcepts {
  markdown: string;
  /** Card heading text → its `<!-- concept: slug -->` slug, so `#slug` links can land. */
  slugByHeading: Record<string, string>;
}

/** Strip the frontmatter and lift each card's slug marker off the page into a lookup. */
export const prepareConceptsMarkdown = (raw: string): PreparedConcepts => {
  const slugByHeading: Record<string, string> = {};
  const markdown = raw
    .replace(FRONTMATTER, "")
    .replace(CARD_MARKER, (_match, heading: string, slug: string) => {
      slugByHeading[heading.trim()] = slug;
      return `### ${heading}`;
    })
    // A card's fields sit on consecutive lines (one paragraph in Markdown); break before each
    // `**Field:**` so they read as rows in a narrow panel.
    .replace(CARD_FIELD, "  \n$1");
  return { markdown, slugByHeading };
};

/** GitHub-style heading id, which is what the page's own `#section` links use. */
export const headingId = (text: string): string =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");

/**
 * Where a link on the page should go from inside the admin app: `#…` stays in the panel, an
 * absolute URL is left alone, and a wiki-relative path (`../repos/ally-be.md`) becomes the wiki
 * viewer's URL for that page.
 */
export const resolveConceptsHref = (href: string): { inPanel: boolean; url: string } => {
  if (href.startsWith("#")) return { inPanel: true, url: href.slice(1) };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { inPanel: false, url: href };
  const resolved = new URL(href, `${CONCEPTS_WIKI_ORIGIN}${CONCEPTS_PAGE_PATH}`);
  return { inPanel: false, url: `${CONCEPTS_WIKI_ORIGIN}/#${resolved.pathname}${resolved.hash}` };
};

const textOf = (node: React.ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node))
    return textOf(node.props.children);
  return "";
};

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; page: PreparedConcepts };

/**
 * Fetches on every open. A result is kept against the attempt that produced it, so Try again
 * shows loading until its own answer lands, while reopening shows the last page at once and
 * swaps in the fresh one when it arrives.
 */
const useConceptsPage = (open: boolean) => {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; state: LoadState } | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    // `no-cache` revalidates with the wiki host each time, so a page published minutes ago shows.
    fetch(CONCEPTS_RAW_URL, { cache: "no-cache", signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then(raw =>
        setResult({ attempt, state: { status: "ready", page: prepareConceptsMarkdown(raw) } }),
      )
      .catch(() => {
        if (!controller.signal.aborted) setResult({ attempt, state: { status: "error" } });
      });
    return () => controller.abort();
  }, [open, attempt]);

  const state: LoadState =
    result && result.attempt === attempt ? result.state : { status: "loading" };
  const retry = useCallback(() => setAttempt(n => n + 1), []);
  return { state, retry };
};

const ConceptsBody: React.FC<{ page: PreparedConcepts }> = ({ page }) => {
  const rootRef = useRef<HTMLDivElement>(null);

  const scrollTo = useCallback((id: string) => {
    const target = rootRef.current?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
    target?.scrollIntoView({ block: "start" });
  }, []);

  const components = useMemo<Components>(() => {
    const heading =
      (Tag: "h1" | "h2" | "h3" | "h4", className: string): Components["h2"] =>
      ({ children }) => {
        const text = textOf(children).trim();
        const id = Tag === "h3" ? (page.slugByHeading[text] ?? headingId(text)) : headingId(text);
        return (
          <Tag id={id} className={`scroll-mt-4 ${className}`}>
            {children}
          </Tag>
        );
      };
    return {
      h1: heading("h1", "mb-3 mt-0 text-xl font-semibold text-typography-900"),
      h2: heading(
        "h2",
        "mb-3 mt-8 border-b border-border-light pb-1 text-lg font-semibold text-typography-900",
      ),
      h3: heading("h3", "mb-2 mt-6 text-base font-semibold text-typography-900"),
      h4: heading("h4", "mb-2 mt-4 text-sm font-semibold text-typography-900"),
      p: ({ children }) => <p className="my-2 text-sm leading-6 text-typography-900">{children}</p>,
      ul: ({ children }) => <ul className="my-2 list-disc pl-5 text-sm">{children}</ul>,
      ol: ({ children }) => <ol className="my-2 list-decimal pl-5 text-sm">{children}</ol>,
      li: ({ children }) => <li className="my-1 leading-6">{children}</li>,
      code: ({ children }) => (
        <code className="rounded bg-background-secondary px-1 py-0.5 font-mono text-xs">
          {children}
        </code>
      ),
      blockquote: ({ children }) => (
        <blockquote className="my-3 border-l-2 border-border-light pl-3 text-typography-600">
          {children}
        </blockquote>
      ),
      table: ({ children }) => (
        <div className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">{children}</table>
        </div>
      ),
      th: ({ children }) => (
        <th className="border-b border-border-light px-2 py-1 align-top font-semibold">
          {children}
        </th>
      ),
      td: ({ children }) => (
        <td className="border-b border-border-light px-2 py-1 align-top">{children}</td>
      ),
      a: ({ href = "", children }) => {
        const target = resolveConceptsHref(href);
        if (target.inPanel) {
          return (
            <a
              href={`#${target.url}`}
              className="text-primary-700 hover:underline"
              onClick={event => {
                event.preventDefault();
                scrollTo(target.url);
              }}
            >
              {children}
            </a>
          );
        }
        return (
          <a
            href={target.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-700 hover:underline"
          >
            {children}
          </a>
        );
      },
    };
  }, [page.slugByHeading, scrollTo]);

  return (
    <div ref={rootRef} className="px-5 pb-8 pt-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {page.markdown}
      </ReactMarkdown>
    </div>
  );
};

/** The panel itself: loading, failure with a retry, or the page. View only. */
export const ConceptsDrawer: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  const copy = en.roadmapV2Tools.concepts;
  const { state, retry } = useConceptsPage(open);
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={copy.title}
      className="w-[44rem] max-w-[90vw]"
      bodyClassName="!p-0"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border-light px-5 py-2 text-xs text-typography-600">
        <span>{copy.source}</span>
        <a
          href={CONCEPTS_WIKI_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-primary-700 hover:underline"
        >
          {copy.openOnWiki}
        </a>
      </div>
      {state.status === "loading" && (
        <div className="px-5 py-4" role="status" aria-label={copy.loading}>
          <SkeletonText paragraph lineCount={12} />
        </div>
      )}
      {state.status === "error" && (
        <div className="flex flex-col items-start gap-3 px-5 py-4">
          <InlineNotification kind="error" lowContrast hideCloseButton title={copy.failed} />
          <Button kind="tertiary" size="sm" onClick={retry}>
            {copy.retry}
          </Button>
        </div>
      )}
      {state.status === "ready" && <ConceptsBody page={state.page} />}
    </SidePanel>
  );
};

/**
 * The header icon that opens the panel. Every Roadmap role — Idea, Builder, Owner — has it; the
 * panel itself lives in `RoadmapFrame`, so the phone's ⋯ sheet can open it too.
 */
export const ConceptsButton: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const copy = en.roadmapV2Tools.concepts;
  return (
    <Tooltip label={copy.tooltip} align="bottom-right">
      <button
        type="button"
        aria-label={copy.button}
        onClick={onOpen}
        className="inline-flex h-8 w-8 items-center justify-center rounded text-typography-600 hover:bg-neutral-100 hover:text-typography-900"
      >
        <Book size={16} aria-hidden />
      </button>
    </Tooltip>
  );
};
