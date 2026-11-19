import {
  FC,
  ReactNode,
  RefObject,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Quote as QuoteIcon, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAddDebriefCommentsMutation } from "@api";
import { DebriefSelectionComment } from "@types";

import { SelectionAnchor, selectionToAnchor } from "./selectionAnchor";

interface PendingComment extends DebriefSelectionComment {
  id: number;
}

interface SelectionCommentsValue {
  /** The person has the feature: otherwise nothing here shows or listens. */
  enabled: boolean;
  items: PendingComment[];
  add: (anchor: SelectionAnchor, body: string) => void;
  remove: (id: number) => void;
  clear: () => void;
}

const Ctx = createContext<SelectionCommentsValue | null>(null);

/**
 * Select-and-comment on the web debrief, for people the Ally team has given it. Comments added in
 * the popup wait here; the feedback box under the debrief shows them and sends them together.
 */
export const SelectionCommentsProvider: FC<{ enabled: boolean; children: ReactNode }> = ({
  enabled,
  children,
}) => {
  const [items, setItems] = useState<PendingComment[]>([]);
  const next = useRef(1);
  const add = useCallback((anchor: SelectionAnchor, body: string) => {
    setItems(list => [...list, { ...anchor, body, id: next.current++ }]);
  }, []);
  const remove = useCallback((id: number) => setItems(list => list.filter(c => c.id !== id)), []);
  const clear = useCallback(() => setItems([]), []);
  const value = useMemo(
    () => ({ enabled, items, add, remove, clear }),
    [enabled, items, add, remove, clear],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useSelectionComments = () => useContext(Ctx);

interface Draft {
  anchor: SelectionAnchor;
  top: number;
  left: number;
}

const POPUP_WIDTH = 340;

/**
 * The popup under the selected words: the words, a comment box and Add. It sits in the flow of the
 * debrief (positioned inside `containerRef`), not over the page. A click anywhere outside it closes
 * it, whatever was typed; Escape closes it too.
 */
export const SelectionCommentPopup: FC<{ containerRef: RefObject<HTMLElement> }> = ({
  containerRef,
}) => {
  const { t } = useTranslation();
  const ctx = useSelectionComments();
  const enabled = !!ctx?.enabled;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [body, setBody] = useState("");
  const [needBody, setNeedBody] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container) return undefined;
    const read = () => {
      // After the browser has settled the selection.
      window.setTimeout(() => {
        const found = selectionToAnchor(window.getSelection(), container);
        if (!found) return;
        const box = container.getBoundingClientRect();
        const left = Math.min(
          Math.max(found.rect.left - box.left, 0),
          Math.max(box.width - POPUP_WIDTH, 0),
        );
        setDraft({ anchor: found.anchor, top: found.rect.bottom - box.top + 8, left });
        setBody("");
        setNeedBody(false);
      }, 0);
    };
    container.addEventListener("mouseup", read);
    container.addEventListener("touchend", read);
    container.addEventListener("keyup", read);
    return () => {
      container.removeEventListener("mouseup", read);
      container.removeEventListener("touchend", read);
      container.removeEventListener("keyup", read);
    };
  }, [enabled, containerRef]);

  useEffect(() => {
    if (!draft) return undefined;
    const onDown = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) setDraft(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [draft]);

  if (!enabled || !draft || !ctx) return null;

  const close = () => setDraft(null);
  const add = () => {
    if (!body.trim()) {
      setNeedBody(true);
      return;
    }
    ctx.add(draft.anchor, body.trim());
    window.getSelection()?.removeAllRanges();
    close();
  };

  return (
    <div
      ref={popupRef}
      role="dialog"
      aria-label={t("postSim.debriefCards.selectionComments.popupLabel")}
      data-testid="selection-comment-popup"
      style={{ top: draft.top, left: draft.left, width: `min(${POPUP_WIDTH}px, 100%)` }}
      className="absolute z-20 flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-lg"
      onKeyDown={e => {
        if (e.key === "Escape") close();
      }}
    >
      <p className="border-l-2 border-gray-300 pl-2 font-primary text-xs text-typography-700">
        “{draft.anchor.quotedText}”
      </p>
      <div className="flex items-center gap-2">
        <input
          autoFocus
          aria-label={t("postSim.debriefCards.selectionComments.inputLabel")}
          placeholder={t("postSim.debriefCards.selectionComments.placeholder")}
          value={body}
          onChange={e => {
            setBody(e.target.value);
            setNeedBody(false);
          }}
          onKeyDown={e => {
            if (e.key === "Enter") add();
          }}
          className="h-9 min-w-0 flex-1 rounded-md border border-gray-200 px-2 font-primary text-sm text-typography-900 focus:border-primary-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={add}
          className="min-h-[36px] rounded-md bg-primary-600 px-3 font-primary text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
        >
          {t("postSim.debriefCards.selectionComments.add")}
        </button>
      </div>
      {needBody && (
        <p role="alert" className="font-primary text-xs text-error-700">
          {t("postSim.debriefCards.selectionComments.needText")}
        </p>
      )}
      <p className="font-primary text-xs text-typography-600">
        {t("postSim.debriefCards.selectionComments.note")}
      </p>
    </div>
  );
};

/**
 * The feedback box under the debrief for people who have the feature: the comments added on
 * selected words as chips, an overall comment, and one Send for all of it. Nothing shows for anyone
 * else.
 */
const FeedbackComposer: FC<{ sessionId: string; ctx: SelectionCommentsValue }> = ({
  sessionId,
  ctx,
}) => {
  const { t } = useTranslation();
  const [send, { isLoading }] = useAddDebriefCommentsMutation();
  const [overall, setOverall] = useState("");
  const [state, setState] = useState<"idle" | "sent" | "failed">("idle");
  const count = ctx.items.length;
  const canSend = (count > 0 || overall.trim().length > 0) && !isLoading;
  const submit = async () => {
    if (!canSend) return;
    try {
      await send({
        sessionId,
        overall: overall.trim() || undefined,
        items: ctx.items.map(c => ({
          section: c.section,
          spanStart: c.spanStart,
          spanEnd: c.spanEnd,
          quotedText: c.quotedText,
          body: c.body,
        })),
      }).unwrap();
      ctx.clear();
      setOverall("");
      setState("sent");
    } catch {
      setState("failed");
    }
  };

  return (
    <div
      data-testid="selection-feedback"
      className="flex flex-col gap-2 border-t border-gray-100 pt-4"
    >
      {ctx.items.map(c => (
        <div
          key={c.id}
          data-testid="selection-feedback-chip"
          className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 font-primary text-sm"
        >
          <QuoteIcon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-typography-600" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-typography-900">“{c.quotedText}”</p>
            <p className="text-typography-700">{c.body}</p>
          </div>
          <button
            type="button"
            aria-label={t("postSim.debriefCards.selectionComments.remove")}
            onClick={() => ctx.remove(c.id)}
            className="rounded p-1 text-typography-600 hover:bg-gray-100"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      ))}
      {state === "sent" && count === 0 ? (
        <p role="status" className="font-primary text-sm font-medium text-primary-900">
          {t("postSim.debrief.feedback.thankYou")}
        </p>
      ) : null}
      <textarea
        aria-label={t("postSim.debriefCards.selectionComments.overallLabel")}
        placeholder={t("postSim.debrief.feedback.commentPlaceholder")}
        value={overall}
        onChange={e => {
          setOverall(e.target.value);
          if (state !== "idle") setState("idle");
        }}
        rows={2}
        className="w-full rounded-md border border-gray-200 p-3 font-primary text-sm text-typography-800 placeholder:text-typography-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-primary text-xs text-typography-700">
          {count > 0
            ? t("postSim.debriefCards.selectionComments.count", { count })
            : t("postSim.debriefCards.selectionComments.hint")}
        </span>
        <button
          type="button"
          data-testid="selection-feedback-send"
          disabled={!canSend}
          onClick={() => void submit()}
          className="min-h-[44px] rounded-md bg-primary-600 px-4 font-primary text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-50"
        >
          {t("postSim.debriefCards.selectionComments.send")}
        </button>
      </div>
      {state === "failed" && (
        <p role="alert" className="font-primary text-xs text-error-700">
          {t("postSim.debrief.feedback.saveFailed")}
        </p>
      )}
    </div>
  );
};

/**
 * The feedback box for people who have the feature; nothing at all for anyone else (the mutation
 * hook is not even set up).
 */
export const SelectionFeedbackComposer: FC<{ sessionId: string }> = ({ sessionId }) => {
  const ctx = useSelectionComments();
  return ctx?.enabled ? <FeedbackComposer sessionId={sessionId} ctx={ctx} /> : null;
};
