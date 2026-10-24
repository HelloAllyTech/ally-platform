import { FC, ReactNode, RefObject, useEffect, useId, useRef } from "react";

import { useTranslation } from "react-i18next";

import { AllyPresence } from "../presence/AllyPresence";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

/** Keeps Tab inside `ref` while active; Escape calls `onEscape`. */
export const useFocusTrap = (
  ref: RefObject<HTMLElement>,
  active: boolean,
  onEscape?: () => void,
) => {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const root = ref.current;
      if (!root) return;
      if (event.key === "Escape") {
        onEscapeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        el => el.offsetParent !== null || el === document.activeElement,
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ref, active]);
};

/**
 * Browser back closes the Theatre or Shelf before it leaves the page (plan
 * §5.2): opening pushes a history entry, back pops it and closes the panel,
 * and closing from the UI removes the entry it pushed.
 */
export const useBackToClose = (open: boolean, onClose: () => void) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const marker = `guide-${Date.now().toString(36)}`;
    let closedByBack = false;
    window.history.pushState({ ...(window.history.state ?? {}), guideOverlay: marker }, "");
    const onPop = () => {
      // Still on our own entry: someone else's history move, not a back past us.
      if (window.history.state?.guideOverlay === marker) return;
      closedByBack = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (!closedByBack && window.history.state?.guideOverlay === marker) window.history.back();
    };
  }, [open]);
};

const BackToAllyPill: FC<{ onClick: () => void; dark?: boolean }> = ({ onClick, dark }) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 font-primary text-sm font-semibold ${
        dark
          ? "text-[var(--g-theatre-ally)] hover:bg-white/10"
          : "border border-[var(--g-line)] bg-[var(--g-card)] text-[var(--g-ink)]"
      }`}
    >
      <AllyPresence state={dark ? "waiting" : "idle"} size={dark ? 28 : 16} />
      {t("guide.panel.backToAlly")}
    </button>
  );
};

export interface ShelfPanelProps {
  open: boolean;
  /** Stepped back to the conversation: hidden, still mounted (the article keeps its place). */
  minimised: boolean;
  /** Push the Stage aside, or overlay it with a scrim (plan §5.2). */
  mode: "push" | "overlay";
  /** Phone: a full-height sheet from the bottom. */
  sheet: boolean;
  width: "reading" | "utility";
  title: string;
  typeWord: string;
  onBack: () => void;
  children: ReactNode;
}

/**
 * The right-hand panel for articles, videos, bucket sort and course info. Its
 * body never scrolls: the article player's read gate owns scrolling (plan
 * §10.4 adapter rules).
 */
export const ShelfPanel: FC<ShelfPanelProps> = ({
  open,
  minimised,
  mode,
  sheet,
  width,
  title,
  typeWord,
  onBack,
  children,
}) => {
  const ref = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // An item can wait minimised while a Shelf utility is open: two panels, two titles.
  const titleId = useId();
  const visible = open && !minimised;
  const overlay = mode === "overlay";
  useFocusTrap(ref, visible && overlay, onBack);
  useBackToClose(visible, onBack);
  useEffect(() => {
    if (visible) headingRef.current?.focus();
  }, [visible]);

  if (!open) return null;
  const widthStyle = width === "reading" ? "min(720px, 55vw)" : "400px";

  return (
    <>
      {overlay && visible && (
        <div className="g-scrim fixed inset-0 z-30" aria-hidden="true" onClick={onBack} />
      )}
      <aside
        ref={ref}
        role={overlay ? "dialog" : "complementary"}
        aria-modal={overlay ? true : undefined}
        aria-labelledby={titleId}
        hidden={!visible}
        data-testid="shelf-panel"
        className={
          overlay
            ? sheet
              ? "fixed inset-x-0 bottom-0 top-3 z-40 flex flex-col rounded-t-2xl bg-[var(--g-card)] shadow-2xl"
              : "fixed inset-y-0 right-0 z-40 flex max-w-[92vw] flex-col bg-[var(--g-card)] shadow-2xl"
            : "flex h-full shrink-0 flex-col border-l border-[var(--g-line)] bg-[var(--g-card)]"
        }
        style={overlay && sheet ? undefined : { width: widthStyle }}
      >
        {sheet && (
          <div
            className="mx-auto mt-2 h-1 w-10 rounded-full bg-[var(--g-line)]"
            aria-hidden="true"
          />
        )}
        <div className="flex items-center gap-3 border-b border-[var(--g-line)] px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="g-label text-[var(--g-ink-faint)]">{typeWord}</p>
            <h2
              id={titleId}
              ref={headingRef}
              tabIndex={-1}
              className="truncate font-primary text-base font-semibold outline-none"
            >
              {title}
            </h2>
          </div>
          <BackToAllyPill onClick={onBack} />
        </div>
        <div className="g-shelf-body min-h-0 flex-1 bg-white">{children}</div>
      </aside>
    </>
  );
};

export interface TheatreHostProps {
  open: boolean;
  minimised: boolean;
  title: string;
  onBack: () => void;
  children: ReactNode;
}

/**
 * Full screen for roleplays, cases, annotation and games (plan §5.2). Ally's
 * orb waits in the corner and "Back to Ally" is always in the same place.
 * Never opens in the still atmosphere (the crisis flow closes it).
 */
export const TheatreHost: FC<TheatreHostProps> = ({ open, minimised, title, onBack, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const visible = open && !minimised;
  useFocusTrap(ref, visible, onBack);
  useBackToClose(visible, onBack);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (visible) headingRef.current?.focus();
  }, [visible]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-theatre-title"
      hidden={!visible}
      data-testid="theatre"
      className="fixed inset-0 z-50 flex flex-col bg-[var(--g-theatre-ground)]"
    >
      <div className="flex h-14 shrink-0 items-center gap-3 px-2 sm:px-4">
        <BackToAllyPill onClick={onBack} dark />
        <h2
          id="guide-theatre-title"
          ref={headingRef}
          tabIndex={-1}
          className="min-w-0 flex-1 truncate font-primary text-sm text-[var(--g-theatre-soft)] outline-none"
        >
          {title}
        </h2>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-white sm:mx-4 sm:mb-4 sm:rounded-2xl">
        {children}
      </div>
    </div>
  );
};

/** A full-height sheet on a phone, a side panel elsewhere (the Course map, support numbers). */
export const Sheet: FC<{
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}> = ({ open, title, onClose, children, testId }) => {
  const ref = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useFocusTrap(ref, open, onClose);
  useBackToClose(open, onClose);
  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <>
      <div className="g-scrim fixed inset-0 z-40" aria-hidden="true" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-sheet-title"
        data-testid={testId}
        className="fixed inset-x-0 bottom-0 top-3 z-50 flex flex-col rounded-t-2xl bg-[var(--g-rail)] shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:top-0 md:w-[400px] md:rounded-none"
      >
        <div
          className="mx-auto mt-2 h-1 w-10 rounded-full bg-[var(--g-line)] md:hidden"
          aria-hidden="true"
        />
        <div className="flex items-center gap-3 px-4 py-2">
          <h2
            id="guide-sheet-title"
            ref={headingRef}
            tabIndex={-1}
            className="min-w-0 flex-1 font-primary text-base font-semibold outline-none"
          >
            {title}
          </h2>
          <BackToAllyPill onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">{children}</div>
      </div>
    </>
  );
};
