import React, { useState } from "react";

import { toast } from "sonner";

import { useAddExpertCommentMutation } from "@api";
import { en } from "@constants";
import { ExpertCommentDraftAnchor, ExpertCommentTag } from "@types";
import { getErrorMessage } from "@utils";

import { COMMENT_TAGS } from "./commentParts";

/**
 * Select to comment (build notes item 19): a small card under the selected words, in the flow of
 * the page rather than over it, with the quoted words, failure-type chips and a comment box.
 * Shown only to people with review rights; the page never opens it for anyone else.
 */
export const CommentPopup: React.FC<{
  runId: string;
  anchor: ExpertCommentDraftAnchor;
  onDone: () => void;
}> = ({ runId, anchor, onDone }) => {
  const s = en.debriefs.session.comment;
  const [tag, setTag] = useState<ExpertCommentTag | null>(null);
  const [body, setBody] = useState("");
  const [add, { isLoading }] = useAddExpertCommentMutation();
  const post = async () => {
    try {
      await add({ runId, comment: { ...anchor, body: body.trim(), tag } }).unwrap();
      toast.success(en.debriefs.expertReview.composer.saved);
      onDone();
    } catch (e) {
      toast.error(getErrorMessage(e, en.debriefs.expertReview.composer.failed));
    }
  };
  return (
    <div
      role="dialog"
      aria-label={s.label}
      data-testid="comment-popup"
      className="flex w-full max-w-[420px] flex-col gap-2.5 self-start rounded-xl border border-neutral-100 bg-white px-3.5 py-3 shadow-[0_8px_24px_rgba(0,0,0,.12)]"
      onKeyDown={e => {
        if (e.key === "Escape") onDone();
      }}
    >
      {anchor.quotedText && (
        <div className="border-l-2 border-neutral-200 pl-2.5 text-[13px] text-neutral-600">
          “{anchor.quotedText}”
          {anchor.turnIndex !== undefined ? ` · ${en.debriefs.session.turn(anchor.turnIndex)}` : ""}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {COMMENT_TAGS.map(t => {
          const on = tag === t;
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              onClick={() => setTag(on ? null : t)}
              className={[
                "h-7 rounded-full border px-2.5 text-xs",
                on
                  ? "border-primary-500 bg-primary-500 text-white"
                  : "border-neutral-200 bg-white text-neutral-700",
              ].join(" ")}
            >
              {en.debriefs.expertReview.tags[t]}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <input
          aria-label={s.input}
          placeholder={s.placeholder}
          value={body}
          autoFocus
          onChange={e => setBody(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && body.trim()) void post();
          }}
          className="h-9 flex-1 border-0 text-[15px] text-typography-900 outline-none"
        />
        <button
          type="button"
          aria-label={s.post}
          disabled={!body.trim() || isLoading}
          onClick={() => void post()}
          className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-primary-500 text-white disabled:opacity-50"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
          </svg>
        </button>
      </div>
    </div>
  );
};
