import { FC, KeyboardEvent, useEffect, useRef } from "react";

import { useTranslation } from "react-i18next";

import { CardGlyph, CheckGlyph, LockGlyph } from "../cards/CardGlyph";
import { ITEM_TYPE_FACTS } from "../cards/itemTypes";

import type { SpineModel, SpineNode } from "../state/spineModel";

const STATE_KEY: Record<SpineNode["state"], string> = {
  done: "guide.spine.done",
  current: "guide.spine.current",
  available: "guide.spine.available",
  locked: "guide.spine.locked",
};

/** A node's dot: filled when done, ringed when current, outlined otherwise. Never colour alone. */
const NodeDot: FC<{ node: SpineNode; bloom?: boolean }> = ({ node, bloom }) => {
  const base = "g-node relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full";
  if (node.state === "done") {
    return (
      <span
        className={`${base} bg-[var(--g-progress)] text-[var(--g-on-dock)]`}
        data-bloom={bloom ? "true" : undefined}
      >
        <CheckGlyph className="h-3 w-3" />
      </span>
    );
  }
  if (node.state === "current") {
    return (
      <span className={`${base} border-2 border-[var(--g-progress)] bg-[var(--g-card)]`}>
        <span className="h-2 w-2 rounded-full bg-[var(--g-progress)]" />
      </span>
    );
  }
  if (node.state === "locked") {
    return (
      <span className={`${base} border border-[var(--g-node-locked)] text-[var(--g-node-locked)]`}>
        <LockGlyph className="h-2.5 w-2.5" />
      </span>
    );
  }
  return <span className={`${base} border-2 border-[var(--g-node-locked)] bg-[var(--g-card)]`} />;
};

export interface SpineListProps {
  model: SpineModel;
  onSelect: (node: SpineNode) => void;
  /** Item that just finished, for the one-off bloom (warm and festive only). */
  bloomItemId?: string | null;
}

/** The full Course map: chapters, items, their states, optional-practice pips. */
export const SpineList: FC<SpineListProps> = ({ model, onSelect, bloomItemId }) => {
  const { t } = useTranslation();
  return (
    <ol className="flex flex-col gap-5" data-testid="spine-list">
      {model.chapters.map(chapter => (
        <li key={chapter.id}>
          <p className="g-label text-[var(--g-rail-meta)]">
            {t("guide.scene.chapterOf", { index: chapter.index + 1, count: model.chapters.length })}
            {chapter.done && <span className="sr-only"> · {t("guide.spine.done")}</span>}
          </p>
          <p className="mt-0.5 font-primary text-[15px] font-semibold leading-5 text-[var(--g-ink)]">
            {chapter.title}
          </p>
          <ol className="mt-2 flex flex-col">
            {chapter.nodes.map(node => (
              <li key={node.id}>
                <button
                  type="button"
                  onClick={() => onSelect(node)}
                  aria-current={node.state === "current" ? "step" : undefined}
                  className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-1 py-1 text-left hover:bg-[var(--g-ground)]"
                >
                  <NodeDot node={node} bloom={bloomItemId === node.id} />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate font-primary text-sm ${
                        node.state === "locked"
                          ? "text-[var(--g-rail-meta)]"
                          : "text-[var(--g-ink)]"
                      } ${node.state === "current" ? "font-semibold" : ""}`}
                    >
                      {node.title}
                    </span>
                    <span className="flex items-center gap-1 font-primary text-xs text-[var(--g-rail-meta)]">
                      <CardGlyph
                        glyph={ITEM_TYPE_FACTS[node.type]?.glyph ?? "page"}
                        className="h-3 w-3"
                      />
                      {t(ITEM_TYPE_FACTS[node.type]?.typeWordKey ?? "guide.spine.item")}
                      {node.minutes
                        ? ` · ${t("guide.card.meta.minutes", { count: node.minutes })}`
                        : ""}
                      <span className="sr-only"> · {t(STATE_KEY[node.state])}</span>
                    </span>
                    {node.practicePips > 0 && (
                      <span
                        className="block font-primary text-xs text-[var(--g-ally-label)]"
                        aria-label={t("guide.scene.practices", { count: node.practicePips })}
                      >
                        {"●".repeat(Math.min(node.practicePips, 5))}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  );
};

/**
 * The Course map as a rail (plan §5.2): a thin thread of nodes that widens
 * into the full map on hover, focus or pin. Dimmed in a hushed room;
 * highlights hidden when still.
 */
export const JourneySpine: FC<{
  model: SpineModel;
  expanded: boolean;
  pinned: boolean;
  onExpand: (open: boolean) => void;
  onTogglePin: () => void;
  onSelect: (node: SpineNode) => void;
  bloomItemId?: string | null;
}> = ({ model, expanded, pinned, onExpand, onTogglePin, onSelect, bloomItemId }) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && expanded && !pinned) {
      onExpand(false);
      (ref.current?.querySelector("button") as HTMLButtonElement | null)?.focus();
    }
  };

  return (
    <div
      className={`relative hidden h-full shrink-0 md:block ${pinned ? "w-[280px]" : "w-12 xl:w-16"}`}
      data-testid="journey-spine"
    >
      <aside
        ref={ref}
        aria-label={t("guide.spine.label")}
        onMouseEnter={() => onExpand(true)}
        onMouseLeave={() => !pinned && onExpand(false)}
        onFocus={() => onExpand(true)}
        onBlur={event => {
          if (!pinned && !event.currentTarget.contains(event.relatedTarget as Node))
            onExpand(false);
        }}
        onKeyDown={onKeyDown}
        data-expanded={expanded}
        className={`absolute inset-y-0 left-0 z-20 flex flex-col border-r border-[var(--g-line)] bg-[var(--g-rail)] transition-[width] duration-200 ${
          expanded || pinned ? "w-[280px] shadow-lg" : "w-full"
        } ${pinned ? "shadow-none" : ""}`}
        style={{ opacity: "var(--atm-rail-opacity)" }}
      >
        <div className="flex items-center justify-between gap-2 px-3 pt-3">
          {expanded || pinned ? (
            <>
              <p className="g-label text-[var(--g-rail-meta)]">{t("guide.spine.label")}</p>
              <button
                type="button"
                onClick={onTogglePin}
                aria-pressed={pinned}
                className="min-h-8 font-primary text-xs text-[var(--g-rail-meta)] underline underline-offset-2"
              >
                {pinned ? t("guide.spine.unpin") : t("guide.spine.pin")}
              </button>
            </>
          ) : (
            <span className="sr-only">{t("guide.spine.label")}</span>
          )}
        </div>
        <div className="px-3 pb-2 pt-1">
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-[var(--g-line)]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={model.total}
            aria-valuenow={model.completed}
            aria-label={t("guide.spine.progress", { done: model.completed, total: model.total })}
          >
            <div className="h-full bg-[var(--g-xp-line)]" style={{ width: `${model.percent}%` }} />
          </div>
          {(expanded || pinned) && (
            <p className="mt-1 font-primary text-xs text-[var(--g-rail-meta)]">
              {t("guide.spine.progress", { done: model.completed, total: model.total })}
            </p>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {expanded || pinned ? (
            <SpineList model={model} onSelect={onSelect} bloomItemId={bloomItemId} />
          ) : (
            <ol className="flex flex-col items-center gap-2 pt-2">
              {model.chapters.map(chapter => (
                <li key={chapter.id} className="flex flex-col items-center gap-2">
                  {chapter.nodes.map(node => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => onSelect(node)}
                      aria-label={`${node.title} · ${t(STATE_KEY[node.state])}`}
                      aria-current={node.state === "current" ? "step" : undefined}
                      className="flex h-7 w-7 items-center justify-center rounded-full"
                    >
                      <NodeDot node={node} bloom={bloomItemId === node.id} />
                    </button>
                  ))}
                  <span aria-hidden="true" className="h-3 w-px bg-[var(--g-line)]" />
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
};

/**
 * On a phone the Course map is a segmented progress thread under the header
 * (one segment per chapter); a tap opens the whole map as a sheet.
 */
export const ProgressThread: FC<{ model: SpineModel; onOpen: () => void }> = ({
  model,
  onOpen,
}) => {
  const { t } = useTranslation();
  const current = model.chapters.find(chapter => chapter.current);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-1 border-b border-[var(--g-line)] bg-[var(--g-rail)] px-4 py-2 text-left md:hidden"
      aria-label={`${t("guide.spine.label")}: ${t("guide.spine.progress", { done: model.completed, total: model.total })}`}
      style={{ opacity: "var(--atm-rail-opacity)" }}
      data-testid="progress-thread"
    >
      <span className="flex w-full gap-1" aria-hidden="true">
        {model.chapters.map(chapter => (
          <span
            key={chapter.id}
            className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--g-line)]"
          >
            <span
              className="block h-full bg-[var(--g-xp-line)]"
              style={{
                width: `${chapter.total ? Math.round((chapter.completed / chapter.total) * 100) : 0}%`,
              }}
            />
          </span>
        ))}
      </span>
      <span className="flex items-center justify-between font-primary text-xs text-[var(--g-rail-meta)]">
        <span className="truncate">{current?.title ?? t("guide.spine.label")}</span>
        <span className="shrink-0">
          {t("guide.spine.progress", { done: model.completed, total: model.total })}
        </span>
      </span>
    </button>
  );
};

/** Moves focus into a sheet's heading when it opens. */
export const useFocusOnOpen = (open: boolean) => {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  return ref;
};
