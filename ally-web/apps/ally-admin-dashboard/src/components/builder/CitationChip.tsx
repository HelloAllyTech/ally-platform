import React from "react";

import { Components } from "react-markdown";
import { Link } from "react-router-dom";

import { en } from "@constants";

import { citationCodeFromHref, citationHref, splitCitations } from "./prdCitations";
import { sharedMarkdownComponents } from "../markdown/markdownComponents";

/**
 * A cited principle, drawn as a small chip that opens its entry in the Context Library. In a new
 * tab, so following a citation never takes you out of the session you are reading.
 */
export const CitationChip: React.FC<{ code: string }> = ({ code }) => (
  <Link
    to={citationHref(code)}
    target="_blank"
    rel="noreferrer"
    aria-label={en.builder.principles.open(code)}
    title={en.builder.principles.open(code)}
    data-testid="prd-citation"
    className="mx-0.5 inline-flex items-center rounded border border-primary-200 bg-primary-50 px-1 py-px align-baseline font-mono text-[11px] leading-4 text-primary-700 no-underline hover:bg-primary-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
  >
    {code}
  </Link>
);

/** Plain text with any `[FP-0142]` in it drawn as chips. */
export const CitedText: React.FC<{ text: string }> = ({ text }) => (
  <>
    {splitCitations(text).map((segment, i) =>
      segment.kind === "code" ? (
        <CitationChip key={i} code={segment.code} />
      ) : (
        <React.Fragment key={i}>{segment.text}</React.Fragment>
      ),
    )}
  </>
);

const SharedLink = sharedMarkdownComponents.a as React.FC<
  React.AnchorHTMLAttributes<HTMLAnchorElement>
>;

/**
 * The shared markdown map, with links made by `linkCitations` drawn as chips. Every other link
 * renders exactly as before.
 */
export const prdMarkdownComponents: Components = {
  ...sharedMarkdownComponents,
  // The shared renderer reads only `href` and `children`, so those are all it is passed.
  a: ({ children, href }) => {
    const code = citationCodeFromHref(href);
    if (code) return <CitationChip code={code} />;
    return <SharedLink href={href}>{children}</SharedLink>;
  },
};
