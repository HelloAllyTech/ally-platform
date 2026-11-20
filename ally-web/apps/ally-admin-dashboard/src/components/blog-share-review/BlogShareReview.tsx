import React, { useEffect, useRef, useState } from "react";

import { Copy, Quote } from "lucide-react";
import { toast } from "sonner";

import {
  BlogStatus,
  BlogSuggestion,
  useCreateBlogReviewLinkMutation,
  useGetBlogReviewQuery,
  useRevokeBlogReviewLinkMutation,
  useSetBlogSuggestionStatusMutation,
} from "@api";
import { en } from "@constants";

import { errorReason } from "../../pages/ContextLibrary/contextLibraryFormat";

export interface BlogShareTarget {
  id: string;
  slug: string;
  status: BlogStatus;
}

const EXPIRY_DAYS = [7, 14, 30, 60];
const DEFAULT_DAYS = 14;

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500";
const quietButton = `inline-flex min-h-[32px] items-center gap-1.5 rounded border border-border-light bg-white px-3 text-sm hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
const primaryButton = `inline-flex min-h-[32px] items-center gap-1.5 rounded bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60 ${focusRing}`;

export const reviewUrl = (token: string): string =>
  `${window.location.origin}/blog/review/${token}`;
export const publicUrl = (slug: string): string => `${window.location.origin}/blog/${slug}`;

const formatWhen = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** A read-only URL with Copy; selects the field when the clipboard is unavailable. */
const CopyField: React.FC<{ label: string; value: string; testId: string }> = ({
  label,
  value,
  testId,
}) => {
  const strings = en.blogShareReview;
  const inputRef = useRef<HTMLInputElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast(strings.copied);
    } catch {
      inputRef.current?.select();
      toast.error(strings.copyFailed);
    }
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-[12rem] flex-1">
        <span className="mb-1 block text-xs text-typography-700">{label}</span>
        <input
          ref={inputRef}
          readOnly
          value={value}
          onFocus={event => event.currentTarget.select()}
          className="h-10 w-full rounded border border-border-light bg-neutral-50 px-2 font-mono text-xs"
          data-testid={testId}
        />
      </label>
      <button type="button" className={quietButton} onClick={() => void copy()}>
        <Copy size={14} aria-hidden /> {strings.copy}
      </button>
    </div>
  );
};

const DaysSelect: React.FC<{
  label: string;
  value: number;
  onChange: (days: number) => void;
}> = ({ label, value, onChange }) => (
  <label className="flex items-center gap-2 text-sm text-typography-700">
    {label}
    <select
      value={value}
      onChange={event => onChange(Number(event.target.value))}
      className="h-9 rounded border border-border-light bg-white px-2"
    >
      {EXPIRY_DAYS.map(days => (
        <option key={days} value={days}>
          {en.blogShareReview.expiryOption(days)}
        </option>
      ))}
    </select>
  </label>
);

const SuggestionRow: React.FC<{
  suggestion: BlogSuggestion;
  busy: boolean;
  onToggle: (suggestion: BlogSuggestion) => void;
}> = ({ suggestion, busy, onToggle }) => {
  const strings = en.blogShareReview;
  const resolved = suggestion.status === "RESOLVED";
  return (
    <li className="space-y-1 py-3" data-testid="blog-suggestion" data-status={suggestion.status}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-typography-900">{suggestion.name}</span>
        {suggestion.email && (
          <span className="text-xs text-typography-600">{suggestion.email}</span>
        )}
        <span className="text-xs text-typography-500">{formatWhen(suggestion.createdAt)}</span>
      </div>
      {suggestion.quote && (
        <blockquote className="flex gap-2 border-l-2 border-primary-300 pl-3 text-typography-600">
          <Quote size={12} aria-hidden className="mt-1 shrink-0" />
          <span>{suggestion.quote}</span>
        </blockquote>
      )}
      <p className={resolved ? "text-typography-500" : "text-typography-800"}>
        {suggestion.comment}
      </p>
      <button
        type="button"
        className={quietButton}
        disabled={busy}
        onClick={() => onToggle(suggestion)}
      >
        {resolved ? strings.reopen : strings.markDone}
      </button>
    </li>
  );
};

/** The dialog body for a draft: link controls, then the suggestions people have sent. */
const DraftSharing: React.FC<{ postId: string }> = ({ postId }) => {
  const strings = en.blogShareReview;
  const review = useGetBlogReviewQuery(postId);
  const [createLink, { isLoading: creating }] = useCreateBlogReviewLinkMutation();
  const [revokeLink, { isLoading: revoking }] = useRevokeBlogReviewLinkMutation();
  const [setStatus, { isLoading: updating }] = useSetBlogSuggestionStatusMutation();
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [confirmingOff, setConfirmingOff] = useState(false);
  const [error, setError] = useState("");

  const run = async (action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
    } catch (failure) {
      const reason = errorReason(failure);
      setError(reason ? `${strings.actionFailed} ${reason}` : strings.actionFailed);
    }
  };

  const link = review.data?.link ?? null;
  const suggestions = review.data?.suggestions ?? [];
  const openCount = suggestions.filter(s => s.status === "OPEN").length;

  if (review.isLoading) return <p className="text-sm text-typography-600">…</p>;
  if (review.isError && !review.data) {
    return (
      <p role="alert" className="text-sm text-red-700">
        {strings.loadFailed} {errorReason(review.error)}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {link ? (
        <section className="space-y-3" data-testid="blog-share-link">
          <CopyField
            label={strings.linkLabel}
            value={reviewUrl(link.token)}
            testId="blog-share-url"
          />
          <p className="text-sm text-typography-700" data-testid="blog-share-expiry">
            {strings.expires(formatWhen(link.expiresAt))}
          </p>
          {confirmingOff ? (
            <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3" role="alert">
              <p className="text-sm text-amber-900">{strings.turnOffConfirm}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={primaryButton}
                  disabled={revoking}
                  onClick={() =>
                    void run(async () => {
                      await revokeLink(postId).unwrap();
                      setConfirmingOff(false);
                    })
                  }
                >
                  {strings.turnOffYes}
                </button>
                <button
                  type="button"
                  className={quietButton}
                  onClick={() => setConfirmingOff(false)}
                >
                  {strings.turnOffCancel}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={quietButton} onClick={() => setConfirmingOff(true)}>
                {strings.turnOff}
              </button>
              <DaysSelect label={strings.extendLabel} value={days} onChange={setDays} />
              <button
                type="button"
                className={quietButton}
                disabled={creating || revoking}
                onClick={() =>
                  void run(async () => {
                    // The server hands back the active link, so end it first to start a new term.
                    await revokeLink(postId).unwrap();
                    await createLink({ id: postId, days }).unwrap();
                  })
                }
              >
                {strings.extend}
              </button>
            </div>
          )}
        </section>
      ) : (
        <section className="flex flex-wrap items-center gap-3">
          <DaysSelect label={strings.expiryLabel} value={days} onChange={setDays} />
          <button
            type="button"
            className={primaryButton}
            disabled={creating}
            onClick={() => void run(() => createLink({ id: postId, days }).unwrap())}
            data-testid="blog-share-create"
          >
            {creating ? strings.creating : strings.create}
          </button>
        </section>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <section aria-labelledby="blog-share-suggestions" className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h3 id="blog-share-suggestions" className="font-semibold text-typography-900">
            {strings.suggestionsHeading(openCount)}
          </h3>
          <button
            type="button"
            className={quietButton}
            disabled={review.isFetching}
            onClick={() => void review.refetch()}
          >
            {review.isFetching ? en.blogPostPreview.refreshing : strings.refreshSuggestions}
          </button>
        </div>
        {suggestions.length === 0 ? (
          <p className="text-sm text-typography-600">{strings.noSuggestions}</p>
        ) : (
          <ul className="divide-y divide-border-light border-y border-border-light text-sm">
            {[...suggestions]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map(suggestion => (
                <SuggestionRow
                  key={suggestion.id}
                  suggestion={suggestion}
                  busy={updating}
                  onToggle={s =>
                    void run(() =>
                      setStatus({
                        id: postId,
                        suggestionId: s.id,
                        status: s.status === "OPEN" ? "RESOLVED" : "OPEN",
                      }).unwrap(),
                    )
                  }
                />
              ))}
          </ul>
        )}
      </section>
    </div>
  );
};

/** Share for review: a small modal. Drafts get a review link; published posts get the public URL. */
export const BlogShareReview: React.FC<{ post: BlogShareTarget; onClose: () => void }> = ({
  post,
  onClose,
}) => {
  const strings = en.blogShareReview;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    // Bubble phase, so a Preview underneath (which listens in capture) leaves Escape to us.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={strings.title}
        data-share-dialog
        className="max-h-full w-full max-w-xl space-y-4 overflow-y-auto rounded-lg bg-white p-5 shadow-xl focus:outline-none"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-typography-900">{strings.title}</h2>
          <button type="button" className={quietButton} onClick={onClose}>
            {strings.close}
          </button>
        </div>
        {post.status === "PUBLISHED" ? (
          <div className="space-y-3 text-sm">
            <p className="text-typography-700">{strings.publishedNotice}</p>
            <CopyField
              label={strings.publicLinkLabel}
              value={publicUrl(post.slug)}
              testId="blog-share-public-url"
            />
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <p className="text-typography-700">{strings.intro}</p>
            <DraftSharing postId={post.id} />
          </div>
        )}
      </div>
    </div>
  );
};

/** The preview's "Share for review" button, with its own dialog. */
export const BlogShareReviewButton: React.FC<{ post: BlogShareTarget; className?: string }> = ({
  post,
  className,
}) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {en.blogShareReview.button}
      </button>
      {open && <BlogShareReview post={post} onClose={() => setOpen(false)} />}
    </>
  );
};
