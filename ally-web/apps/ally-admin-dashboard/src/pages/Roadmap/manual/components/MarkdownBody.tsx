import React, {
  Children,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { AnimatePresence, motion } from "framer-motion";
import ReactMarkdown, { Components } from "react-markdown";
import { Link } from "react-router-dom";
import remarkGfm from "remark-gfm";

import { sharedMarkdownComponents } from "@components/markdown";
import { en } from "@constants";

import { motionTransition, popVariants, useReducedMotionPreference } from "../../../../motion";
import { useManualData } from "../hooks/useManualData";
import { headingId, manualHref, preprocessWikilinks, slugFromManualHref } from "../utils/wikilinks";

/** Plain text of rendered children, for a heading's id. */
const textOf = (node: React.ReactNode): string =>
  Children.toArray(node)
    .map(child => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (isValidElement<{ children?: React.ReactNode }>(child))
        return textOf(child.props.children);
      return "";
    })
    .join("");

/**
 * An internal link to another manual page, with a preview card (title + one-line summary from the
 * tree already loaded, so hovering makes no request). The card opens after a short pause on hover
 * or at once on keyboard focus, and closes on leave, blur or Escape.
 */
export const WikiLink: React.FC<{ slug: string; children: React.ReactNode }> = ({
  slug,
  children,
}) => {
  const { bySlug } = useManualData();
  const reduced = useReducedMotionPreference();
  const page = bySlug.get(slug);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const cardId = useId();
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  const show = (delay: number) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    if (timer.current) window.clearTimeout(timer.current);
    setOpen(false);
  };
  return (
    <span className="relative inline">
      <Link
        to={manualHref(slug)}
        className="manual-wikilink"
        aria-describedby={open && page ? cardId : undefined}
        onMouseEnter={() => show(280)}
        onMouseLeave={hide}
        onFocus={() => show(0)}
        onBlur={hide}
        onKeyDown={event => {
          if (event.key === "Escape") hide();
        }}
        onClick={hide}
      >
        {children}
      </Link>
      <AnimatePresence>
        {open && page && (
          <motion.span
            id={cardId}
            role="tooltip"
            aria-label={en.productManual.previewLabel(page.title)}
            className="pointer-events-none absolute left-0 top-full z-20 mt-2 block w-72 border border-border-light bg-white p-3 text-left shadow-lg"
            initial="initial"
            animate="animate"
            exit="exit"
            variants={popVariants(reduced)}
            transition={motionTransition("fast", "productive", reduced)}
            style={{ transformOrigin: "top left" }}
          >
            <span className="block text-sm font-semibold leading-snug text-typography-900">
              {page.title}
            </span>
            {page.summary && (
              <span className="mt-1 block text-xs leading-relaxed text-typography-600">
                {page.summary}
              </span>
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
};

const heading =
  (Tag: "h2" | "h3", className: string): Components["h2"] =>
  ({ children }) => {
    const id = headingId(textOf(children));
    return (
      <Tag id={id || undefined} className={className}>
        {children}
      </Tag>
    );
  };

/** The reading column's renderers: the shared chat set, re-sized for long-form reading. */
const readerComponents: Components = {
  ...sharedMarkdownComponents,
  h1: heading("h2", "mt-10 mb-3 text-2xl font-semibold leading-tight text-typography-900"),
  h2: heading("h2", "mt-10 mb-3 text-2xl font-semibold leading-tight text-typography-900"),
  h3: heading("h3", "mt-8 mb-2 text-xl font-semibold leading-snug text-typography-900"),
  p: ({ children }) => <p className="mb-5 text-typography-900">{children}</p>,
  ul: ({ children }) => <ul className="mb-5 list-disc space-y-2 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="mb-5 list-decimal space-y-2 pl-6">{children}</ol>,
  li: ({ children }) => <li className="text-typography-900">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mb-5 border-l-2 border-primary-500 pl-4 text-typography-700">
      {children}
    </blockquote>
  ),
  a: ({ children, href }) => {
    const slug = slugFromManualHref(href);
    if (slug) return <WikiLink slug={slug}>{children}</WikiLink>;
    return (
      <a href={href} target="_blank" rel="noreferrer" className="manual-wikilink">
        {children}
      </a>
    );
  },
};

/** Compact renderers for chat answers: same link handling, chat-sized text. */
const chatComponents: Components = {
  ...sharedMarkdownComponents,
  a: readerComponents.a,
};

/**
 * A manual body or a chat answer as markdown (GFM). `[[slug]]` / `[[slug|label]]` become links
 * only for slugs the loaded tree has; the rest read as plain text.
 */
export const MarkdownBody: React.FC<{ body: string; variant?: "reader" | "chat" }> = ({
  body,
  variant = "reader",
}) => {
  const { bySlug } = useManualData();
  // slug → title: an unlabelled [[slug]] reads as the page's title.
  const known = useMemo(
    () => new Map([...bySlug.values()].map(page => [page.slug, page.title])),
    [bySlug],
  );
  const source = useMemo(() => preprocessWikilinks(body ?? "", known), [body, known]);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={variant === "reader" ? readerComponents : chatComponents}
    >
      {source}
    </ReactMarkdown>
  );
};
