import { FC, FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { Link, Navigate, useParams } from "react-router-dom";

import { useCreateBlogReviewSuggestionMutation, useGetBlogReviewQuery } from "@api";
import { ROUTES } from "@constants";

import { BlogArticle, formatDate } from "./BlogArticle";
import { BlogFooter } from "./BlogFooter";
import { BlogHeader } from "./BlogHeader";
import { usePageMeta } from "./usePageMeta";

const MAX_COMMENT = 2000;
const MAX_QUOTE = 500;
const STORAGE_KEY = "blog-review-reader";

const loadReader = (): { name: string; email: string } => {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}");
    return { name: parsed.name ?? "", email: parsed.email ?? "" };
  } catch {
    return { name: "", email: "" };
  }
};

const saveReader = (name: string, email: string) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ name, email }));
  } catch {
    // Storage can be blocked; the form still works without it.
  }
};

const inputClass =
  "mt-1 w-full rounded-lg border border-gray-900/20 bg-white px-3 py-2 text-base text-gray-900 focus:border-blog-accent focus:outline-none focus:ring-1 focus:ring-blog-accent";

const SuggestionPanel: FC<{
  token: string;
  quote: string;
  onQuoteChange: (value: string) => void;
}> = ({ token, quote, onQuoteChange }) => {
  const [createSuggestion, { isLoading }] = useCreateBlogReviewSuggestionMutation();
  const [reader] = useState(loadReader);
  const [name, setName] = useState(reader.name);
  const [email, setEmail] = useState(reader.email);
  const [comment, setComment] = useState("");
  const [touched, setTouched] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const nameMissing = !name.trim();
  const commentMissing = !comment.trim();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    setMessage(null);
    if (nameMissing || commentMissing) return;

    const trimmedQuote = quote.trim().slice(0, MAX_QUOTE);
    try {
      await createSuggestion({
        token,
        body: {
          name: name.trim(),
          ...(email.trim() ? { email: email.trim() } : {}),
          comment: comment.trim(),
          ...(trimmedQuote ? { quote: trimmedQuote } : {}),
        },
      }).unwrap();
      saveReader(name.trim(), email.trim());
      setComment("");
      onQuoteChange("");
      setTouched(false);
      setMessage({ kind: "ok", text: "Thank you. Your suggestion was sent to the author." });
    } catch (error) {
      const status = (error as { status?: number })?.status;
      setMessage({
        kind: "error",
        text:
          status === 429
            ? "You are sending suggestions a little fast, or this link has reached its limit. Please try again later."
            : "Something went wrong and your suggestion was not sent. Please try again.",
      });
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <h2 className="text-lg text-gray-900">Suggest a change</h2>

      <div>
        <label htmlFor="review-name" className="text-sm text-gray-700">
          Your name
        </label>
        <input
          id="review-name"
          value={name}
          maxLength={80}
          onChange={event => setName(event.target.value)}
          aria-invalid={touched && nameMissing}
          aria-describedby={touched && nameMissing ? "review-name-error" : undefined}
          className={inputClass}
        />
        {touched && nameMissing && (
          <p id="review-name-error" className="mt-1 text-sm text-blog-error">
            Please enter your name.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="review-email" className="text-sm text-gray-700">
          Email (optional, so the author can reply)
        </label>
        <input
          id="review-email"
          type="email"
          value={email}
          onChange={event => setEmail(event.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="review-quote" className="text-sm text-gray-700">
          About this text (optional)
        </label>
        <textarea
          id="review-quote"
          value={quote}
          rows={2}
          maxLength={MAX_QUOTE}
          onChange={event => onQuoteChange(event.target.value)}
          placeholder="Select text in the article to fill this in"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="review-comment" className="text-sm text-gray-700">
          Your comment
        </label>
        <textarea
          id="review-comment"
          value={comment}
          rows={4}
          maxLength={MAX_COMMENT}
          onChange={event => setComment(event.target.value)}
          aria-invalid={touched && commentMissing}
          aria-describedby={touched && commentMissing ? "review-comment-error" : undefined}
          className={inputClass}
        />
        <div className="flex justify-between text-sm">
          <span id="review-comment-error" className="text-blog-error">
            {touched && commentMissing ? "Please write a comment." : ""}
          </span>
          <span className="text-gray-500">
            {comment.length}/{MAX_COMMENT}
          </span>
        </div>
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="min-h-[44px] w-full rounded-full bg-gray-900 px-5 py-2 text-base text-white transition-colors hover:bg-gray-800 disabled:opacity-60"
      >
        {isLoading ? "Sending…" : "Send suggestion"}
      </button>

      <div role="status" aria-live="polite">
        {message && (
          <p className={message.kind === "ok" ? "text-blog-body" : "text-blog-error"}>
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
};

export const BlogReview: FC = () => {
  const { token = "" } = useParams<{ token: string }>();
  const { data, isLoading, isError } = useGetBlogReviewQuery({ token }, { skip: !token });
  const post = data?.post;

  const [quote, setQuote] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [chip, setChip] = useState<{ text: string; top: number; left: number } | null>(null);
  const articleRef = useRef<HTMLDivElement>(null);

  usePageMeta({
    title: post ? `Draft: ${post.title}` : "Draft review",
    robots: "noindex, nofollow",
    type: "website",
  });

  const onSelectionEnd = useCallback(() => {
    // Wait a tick so the browser has finalised the selection.
    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? "";
      const container = articleRef.current;
      if (!selection || !text || selection.rangeCount === 0 || !container) {
        setChip(null);
        return;
      }
      const range = selection.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) {
        setChip(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setChip({
        text: text.slice(0, MAX_QUOTE),
        top: Math.max(rect.top - 44, 8),
        left: Math.max(rect.left, 8),
      });
    }, 0);
  }, []);

  useEffect(() => {
    if (!chip) return undefined;
    const clear = () => {
      if (!window.getSelection()?.toString().trim()) setChip(null);
    };
    document.addEventListener("selectionchange", clear);
    return () => document.removeEventListener("selectionchange", clear);
  }, [chip]);

  if (data?.status === "PUBLISHED") {
    return <Navigate to={`/blog/${data.slug}`} replace />;
  }

  const applyChip = () => {
    if (!chip) return;
    setQuote(chip.text);
    setSheetOpen(true);
    setChip(null);
  };

  return (
    <div className="blog-serif flex min-h-dvh flex-col bg-gray-50 text-gray-900">
      <BlogHeader />

      {isLoading ? (
        <p className="mx-auto mt-12 w-full max-w-2xl px-4 text-gray-700">Loading…</p>
      ) : isError || !post ? (
        <div className="mx-auto w-full max-w-2xl flex-1 px-4 pt-12 sm:px-6">
          <p className="text-gray-700">
            This review link is not valid any more. Ask the author for a new one.
          </p>
          <Link
            to={ROUTES.BLOG}
            className="mt-4 inline-flex min-h-[44px] items-center text-sm underline underline-offset-2"
          >
            Go to the blog home
          </Link>
        </div>
      ) : (
        <>
          <div
            role="note"
            className="border-b border-blog-accent/30 bg-blog-accent-tint px-4 py-3 text-center text-sm text-gray-900"
          >
            <strong>This is a draft for review. It is not published and may change.</strong> This
            link works until {formatDate(data?.expiresAt)}.
          </div>

          <div className="mx-auto flex w-full max-w-6xl flex-1 justify-center gap-10 px-4 pb-24 pt-8 sm:px-6 sm:pt-12 xl:justify-between">
            <div
              ref={articleRef}
              onMouseUp={onSelectionEnd}
              onTouchEnd={onSelectionEnd}
              className="w-full max-w-2xl"
            >
              <BlogArticle post={post} />
            </div>

            <aside
              aria-label="Suggest a change"
              className={`${
                sheetOpen ? "" : "max-xl:hidden"
              } max-xl:fixed max-xl:inset-x-0 max-xl:bottom-0 max-xl:z-30 max-xl:max-h-[80dvh] max-xl:overflow-y-auto max-xl:rounded-t-2xl max-xl:border-t max-xl:border-gray-900/10 max-xl:bg-gray-50 max-xl:p-5 max-xl:shadow-2xl xl:sticky xl:top-8 xl:h-fit xl:w-80 xl:shrink-0 xl:rounded-2xl xl:border xl:border-gray-900/10 xl:bg-white xl:p-5`}
            >
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="mb-2 min-h-[44px] text-sm text-gray-500 xl:hidden"
              >
                Close
              </button>
              <SuggestionPanel token={token} quote={quote} onQuoteChange={setQuote} />
            </aside>
          </div>

          {!sheetOpen && (
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="fixed bottom-4 right-4 z-20 min-h-[44px] rounded-full bg-gray-900 px-5 text-white shadow-lg xl:hidden"
            >
              Suggest a change
            </button>
          )}

          {chip && (
            <button
              type="button"
              // Keep the text selected while the chip is pressed.
              onMouseDown={event => event.preventDefault()}
              onClick={applyChip}
              style={{ position: "fixed", top: chip.top, left: chip.left }}
              className="z-40 rounded-full bg-gray-900 px-3 py-2 text-sm text-white shadow-lg"
            >
              Suggest a change to this text
            </button>
          )}
        </>
      )}

      <BlogFooter containerClassName="max-w-2xl" />
    </div>
  );
};
