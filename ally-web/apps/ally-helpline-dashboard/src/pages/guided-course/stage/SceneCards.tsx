import { FC } from "react";

import { useTranslation } from "react-i18next";

import { CheckGlyph } from "../cards/CardGlyph";

import type { SceneState } from "../state/guideFeedReducer";
import type { SpineChapter } from "../state/spineModel";

/**
 * Opens a scene (card grammar §5.1): chapter number, title, the stakes in one
 * line, and what's in it. Skippable (Stacks: "Cutscene Pacing Controls Game
 * Rhythm and Emphasis"). A chapter with trigger warnings gets a content note
 * that can't be dismissed while the warning exists.
 */
export const SceneTitleCard: FC<{
  scene: SceneState;
  chapter: SpineChapter | null;
  chapterCount: number;
  onSkipIntro?: () => void;
}> = ({ scene, chapter, chapterCount, onSkipIntro }) => {
  const { t } = useTranslation();
  const minutes = chapter?.nodes.reduce((sum, node) => sum + (node.minutes ?? 0), 0) ?? 0;
  const hasBoss = chapter?.nodes.some(node => node.boss) ?? false;
  const meta = chapter
    ? [
        t("guide.scene.pieces", { count: chapter.total }),
        hasBoss ? t("guide.scene.hasRoleplay") : null,
        minutes ? t("guide.scene.about", { count: minutes }) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <header
      className="g-rise mt-4 border-t border-[var(--g-line)] pt-5"
      data-testid={`scene-${scene.sceneId}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="g-label text-[var(--g-ink-faint)]">
          {chapter
            ? t("guide.scene.chapterOf", { index: chapter.index + 1, count: chapterCount })
            : t("guide.scene.chapter")}
        </p>
        {onSkipIntro && (
          <button
            type="button"
            onClick={onSkipIntro}
            className="min-h-6 font-primary text-sm text-[var(--g-ink-soft)] underline underline-offset-2 max-md:min-h-11"
          >
            {t("guide.scene.skipIntro")}
          </button>
        )}
      </div>
      <h2 className="mt-1 font-primary text-2xl font-semibold leading-8 text-[var(--g-ink)] [text-wrap:balance]">
        {scene.title}
      </h2>
      {scene.stakes && <p className="g-prose mt-1 text-[var(--g-ink-soft)]">{scene.stakes}</p>}
      {meta && <p className="g-caption mt-2">{meta}</p>}
      {chapter?.hasWarnings && (
        <p className="mt-3 rounded-lg bg-[var(--g-card)] px-3 py-2 font-primary text-sm text-[var(--g-ink-soft)]">
          {t("guide.scene.contentNote")}
        </p>
      )}
    </header>
  );
};

/**
 * Closes a scene (card grammar §5.2): what the learner did, the optional
 * practice pips and at most one noticing. No percentages, scores or XP.
 */
export const SceneReceipt: FC<{
  scene: SceneState;
  chapterIndex: number | null;
  expanded: boolean;
  onToggle: () => void;
}> = ({ scene, chapterIndex, expanded, onToggle }) => {
  const { t } = useTranslation();
  const receipt = scene.receipt;
  const pips = receipt?.sideQuests ?? 0;
  return (
    <section
      className="g-rise rounded-2xl border border-[var(--g-line)] bg-[var(--g-card)] px-4 py-3"
      data-testid={`receipt-${scene.sceneId}`}
      aria-label={t("guide.scene.done", { title: scene.title })}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="g-label flex items-center gap-1.5 text-[var(--g-ink-faint)]">
          <CheckGlyph className="text-[var(--g-progress)]" />
          {chapterIndex !== null
            ? t("guide.scene.chapterDone", { index: chapterIndex + 1 })
            : t("guide.scene.done", { title: scene.title })}
        </p>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="min-h-6 font-primary text-sm text-[var(--g-ink-soft)] underline underline-offset-2 max-md:min-h-11"
        >
          {expanded ? t("guide.scene.collapse") : t("guide.scene.expand")}
        </button>
      </div>
      {receipt && receipt.behaviourLabels.length > 0 && (
        <p className="mt-1 font-secondary text-base text-[var(--g-ink)]">
          {receipt.behaviourLabels.join(" · ")}
        </p>
      )}
      {pips > 0 && (
        <p className="g-caption mt-1">
          <span aria-hidden="true">{"●".repeat(Math.min(pips, 5))} </span>
          {t("guide.scene.practices", { count: pips })}
        </p>
      )}
      {receipt?.noticing && (
        <blockquote className="mt-2 border-l-2 border-[var(--g-quote-rule)] pl-3 font-secondary italic text-[var(--g-ink)]">
          “{receipt.noticing}”
          <span className="g-caption block not-italic">{t("guide.notebook.saved")}</span>
        </blockquote>
      )}
    </section>
  );
};
