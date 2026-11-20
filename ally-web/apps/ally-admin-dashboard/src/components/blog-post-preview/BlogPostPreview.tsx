import React, { useCallback, useEffect, useRef, useState } from "react";

import { RichTextRenderer } from "@ally-ui-mono/ui-shared";
import { BlogPost, useLazyGetBlogQuery } from "@api";
import { BlogShareReviewButton } from "@components/blog-share-review";
import { en } from "@constants";

export interface BlogPreviewData {
  title: string;
  tldr?: string | null;
  body?: string | null;
  tags: string[];
  coverColor: string;
  authorName?: string | null;
  headerImageUrl?: string | null;
  status: "DRAFT" | "PUBLISHED";
  /** Shown as the date line; falls back to today (an unsaved post has none). */
  date?: string | null;
}

interface BlogPostPreviewProps {
  post: BlogPreviewData;
  onClose: () => void;
  /** The saved post this preview is of. Without it there is nothing to refresh or share. */
  saved?: { id: string; slug: string };
  /** True when `post` is unsaved form values, so Refresh swaps them for the saved version. */
  unsaved?: boolean;
}

const toPreview = (blog: BlogPost): BlogPreviewData => ({
  title: blog.title,
  tldr: blog.tldr,
  body: blog.body,
  tags: blog.tags ?? [],
  coverColor: blog.coverColor,
  authorName: blog.authorName,
  headerImageUrl: blog.headerImageUrl,
  status: blog.status,
  date: blog.publishedAt ?? blog.createdAt,
});

const btnClass =
  "inline-flex min-h-[32px] items-center px-3 text-sm border focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 bg-white text-typography-700 border-border-light hover:bg-neutral-100 disabled:opacity-60";

/** Re-reads the saved post, because it may have been edited elsewhere (for example by Claude). */
const RefreshControl: React.FC<{
  postId: string;
  unsaved: boolean;
  onLoaded: (post: BlogPreviewData, slug: string) => void;
}> = ({ postId, unsaved, onLoaded }) => {
  const strings = en.blogPostPreview;
  const [load, { isFetching }] = useLazyGetBlogQuery();
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (loadedAt === null) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [loadedAt]);

  const refresh = async () => {
    setFailed(false);
    const result = await load(postId, false);
    if (result.data) {
      onLoaded(toPreview(result.data), result.data.slug);
      setLoadedAt(Date.now());
      setNow(Date.now());
    } else {
      setFailed(true);
    }
  };

  const seconds = loadedAt === null ? 0 : Math.max(0, Math.round((now - loadedAt) / 1000));
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="blog-preview-refresh">
      <button
        type="button"
        className={btnClass}
        disabled={isFetching}
        onClick={() => void refresh()}
      >
        {isFetching ? strings.refreshing : strings.refresh}
      </button>
      {isFetching && (
        <span
          role="status"
          aria-label={strings.refreshing}
          className="h-4 w-4 animate-spin rounded-full border-2 border-primary-500 border-t-transparent"
        />
      )}
      {loadedAt !== null && !failed && (
        <span className="text-xs text-typography-600" aria-live="polite">
          {seconds < 5 ? strings.updatedJustNow : strings.updatedAgo(seconds)}
          {unsaved && ` · ${strings.savedVersionNote}`}
        </span>
      )}
      {failed && (
        <span role="alert" className="text-xs text-red-700">
          {strings.refreshFailed}
        </span>
      )}
    </div>
  );
};

type Device = "desktop" | "mobile";

const DEVICE_WIDTH: Record<Device, number> = { desktop: 1000, mobile: 390 };

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const formatDate = (value?: string | null) =>
  new Date(value || Date.now()).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

// Scoped to .bpp-*; mirrors the public blog's typography (helpline BlogPost.tsx).
const CSS = `
.bpp-page{font-family:"IBM Plex Serif",Georgia,serif;background:#FAF9F5;color:#29261f}
.bpp-page pre,.bpp-page code{font-family:"IBM Plex Serif",Georgia,serif}
.bpp-body{margin-top:2rem;max-width:none;overflow-wrap:break-word;font-size:17px;line-height:1.75;color:#33322F}
.bpp-body h1{font-size:1.875rem;line-height:2.25rem;color:#29261f;margin:2.5rem 0 1rem}
.bpp-body h2{font-size:1.5rem;line-height:2rem;color:#29261f;margin:2.5rem 0 .75rem}
.bpp-body h3{font-size:1.25rem;line-height:1.75rem;color:#29261f;margin:2rem 0 .5rem}
.bpp-body p{margin:1rem 0}
.bpp-body a{text-decoration:underline;text-underline-offset:2px}
.bpp-body ul{list-style:disc;padding-left:1.5rem;margin:1rem 0}
.bpp-body ol{list-style:decimal;padding-left:1.5rem;margin:1rem 0}
.bpp-body li{margin:.25rem 0}
.bpp-body blockquote{border-left:2px solid #D97757;padding-left:1.25rem;margin:1.5rem 0;font-size:1.125rem;color:#565045}
.bpp-body hr{border:0;border-top:1px solid rgba(41,38,31,.15);margin:2rem 0}
.bpp-body pre{overflow-x:auto;background:rgba(41,38,31,.06);border-radius:.5rem;padding:1rem;margin:1.5rem 0;font-size:.9em}
.bpp-body code{background:rgba(41,38,31,.06);border-radius:.25rem;padding:.1em .3em;font-size:.9em}
.bpp-body pre code{background:none;padding:0}
.bpp-body img{height:auto;max-width:100%;border-radius:.75rem}
`;

export const BlogPostPreview: React.FC<BlogPostPreviewProps> = ({
  post: initialPost,
  onClose,
  saved,
  unsaved = false,
}) => {
  const strings = en.blogPostPreview;
  const [refreshed, setRefreshed] = useState<{ post: BlogPreviewData; slug: string } | null>(null);
  const post = refreshed?.post ?? initialPost;
  const [device, setDevice] = useState<Device>("desktop");
  const dialogRef = useRef<HTMLDivElement>(null);
  const isDraft = post.status !== "PUBLISHED";

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // A share dialog opened from here handles its own keys.
      if (dialogRef.current?.querySelector("[data-share-dialog]")) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      previous?.focus?.();
    };
  }, [handleKeyDown]);

  const btn =
    "inline-flex min-h-[32px] items-center px-3 text-sm border focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500";

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={strings.title}
      className="fixed inset-0 z-[70] flex flex-col bg-white focus:outline-none"
    >
      <style>{CSS}</style>
      <div className="flex flex-wrap items-center gap-3 border-b border-border-light bg-white px-4 py-3">
        <span className="text-base font-semibold text-typography-900">{strings.title}</span>
        <span
          data-testid="blog-preview-status"
          className={`text-xs px-2 py-1 rounded-full ${
            isDraft ? "bg-gray-100 text-typography-600" : "bg-green-100 text-green-700"
          }`}
        >
          {isDraft ? strings.draft : strings.published}
        </span>
        <div role="group" aria-label={strings.deviceGroup} className="ml-auto flex">
          {(["desktop", "mobile"] as Device[]).map(d => (
            <button
              key={d}
              type="button"
              aria-pressed={device === d}
              onClick={() => setDevice(d)}
              className={`${btn} ${
                device === d
                  ? "bg-primary-500 text-white border-primary-500"
                  : "bg-white text-typography-700 border-border-light hover:bg-neutral-100"
              }`}
            >
              {d === "desktop" ? strings.desktop : strings.mobile}
            </button>
          ))}
        </div>
        {saved && (
          <>
            <RefreshControl
              postId={saved.id}
              unsaved={unsaved}
              onLoaded={(p, slug) => setRefreshed({ post: p, slug })}
            />
            <BlogShareReviewButton
              post={{ id: saved.id, slug: refreshed?.slug ?? saved.slug, status: post.status }}
              className={`${btnClass}`}
            />
          </>
        )}
        <button
          type="button"
          onClick={onClose}
          className={`${btn} bg-white text-typography-700 border-border-light hover:bg-neutral-100`}
        >
          {strings.close}
        </button>
      </div>
      {isDraft && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-900">
          {strings.draftNotice}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-100">
        <div
          data-testid="blog-preview-frame"
          style={{ maxWidth: DEVICE_WIDTH[device] }}
          className="bpp-page mx-auto min-h-full w-full px-4 pb-16 pt-8 sm:px-6"
        >
          <article>
            <header>
              <p className="text-sm text-[#928b7c]">{formatDate(post.date)}</p>
              <h1 className="mt-4 text-4xl leading-[1.15]">{post.title || strings.untitled}</h1>
              {post.tldr && <p className="mt-6 text-xl leading-8 text-[#565045]">{post.tldr}</p>}
              {post.authorName && (
                <p className="mt-6 text-sm text-[#928b7c]">
                  {strings.by} {post.authorName}
                </p>
              )}
              <div className="mt-8 border-t border-[#29261f]/10" />
            </header>

            {post.headerImageUrl ? (
              <img
                src={post.headerImageUrl}
                alt={post.title}
                className="mb-10 mt-8 w-full rounded-2xl object-cover"
              />
            ) : (
              <div
                data-testid="blog-preview-cover"
                aria-hidden="true"
                className="mb-10 mt-8 h-48 w-full rounded-2xl"
                style={{ backgroundColor: post.coverColor }}
              />
            )}

            <RichTextRenderer content={post.body ?? ""} allowImages className="bpp-body" />

            {post.tags.length > 0 && (
              <div className="mt-12 flex flex-wrap gap-2 border-t border-[#29261f]/10 pt-6">
                {post.tags.map(tag => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full border border-[#29261f]/10 bg-white px-3 py-1 text-sm text-[#565045]"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </article>
        </div>
      </div>
    </div>
  );
};
