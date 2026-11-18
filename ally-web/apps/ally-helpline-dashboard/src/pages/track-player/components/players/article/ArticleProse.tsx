import { FC, useMemo } from "react";

import { sanitizeArticleRender } from "../articleHtml";

import "./article.css";

interface ArticleProseProps {
  /** A prepared (already sanitized) body segment; sanitized again here. */
  html: string;
  className?: string;
}

/**
 * One block of article prose. The shared RichTextRenderer's look, with an
 * allow-list that also keeps what the article player adds — callout boxes,
 * heading ids — which the shared renderer would strip.
 */
export const ArticleProse: FC<ArticleProseProps> = ({ html, className = "" }) => {
  const safe = useMemo(() => sanitizeArticleRender(html), [html]);
  if (!safe) return null;
  return (
    <div
      data-testid="article-prose"
      className={`ally-article-prose rich-text-content prose prose-sm max-w-none leading-relaxed text-typography-900 [&_blockquote]:my-2 [&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-typography-700 [&_h1]:my-2 [&_h1]:text-[1.25em] [&_h1]:font-bold [&_h2]:my-1.5 [&_h2]:text-[1.125em] [&_h2]:font-semibold [&_h3]:my-1 [&_h3]:text-[1em] [&_h3]:font-semibold [&_hr]:my-3 [&_hr]:border-gray-200 [&_img]:my-2 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-6 ${className}`}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
};
