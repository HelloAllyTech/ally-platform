import { AllyGuideStageOutcome, AllyGuideStageTiming } from "@types";

export interface WaterfallRow {
  stage: string;
  ms: number;
  outcome: AllyGuideStageOutcome;
  /** Where the bar starts, 0–100 along the shared scale. */
  offsetPct: number;
  /** How wide it is, 0–100. Zero for a skipped stage, which has no bar to draw. */
  widthPct: number;
}

export interface Waterfall {
  /** The span the bars share, in milliseconds. */
  totalMs: number;
  rows: WaterfallRow[];
  /** Where the first token landed on the same scale, or null when the turn never produced one. */
  firstTokenPct: number | null;
}

/** A bar this thin is invisible; a fast stage still has to be findable. */
const MIN_BAR_PCT = 0.8;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Lays a turn's stages on one shared time scale.
 *
 * `startedAt` is wall-clock epoch milliseconds, so offsets are measured from the first stage that
 * actually ran. A skipped stage is stamped with the moment it was skipped, which says nothing about
 * where it would have sat: it gets no bar and is shown as a row of its own, last in the order the
 * pipeline listed it.
 *
 * `ttftMs` is measured from the turn's own start, which is the first stage's start to within a
 * millisecond or two, so it is placed on the same scale rather than given one of its own.
 */
export const buildWaterfall = (
  stages: AllyGuideStageTiming[] | null | undefined,
  ttftMs: number | null | undefined,
): Waterfall => {
  const list = stages ?? [];
  const ran = list.filter(stage => stage.outcome !== "skipped");
  if (ran.length === 0) {
    return {
      totalMs: 0,
      rows: list.map(stage => ({
        stage: stage.stage,
        ms: stage.ms,
        outcome: stage.outcome,
        offsetPct: 0,
        widthPct: 0,
      })),
      firstTokenPct: null,
    };
  }

  const origin = Math.min(...ran.map(stage => stage.startedAt));
  const end = Math.max(...ran.map(stage => stage.startedAt + stage.ms));
  // A turn whose stages all took 0 ms still needs a scale to divide by.
  const totalMs = Math.max(end - origin, 1);

  const rows = list.map<WaterfallRow>(stage => {
    if (stage.outcome === "skipped") {
      return {
        stage: stage.stage,
        ms: stage.ms,
        outcome: stage.outcome,
        offsetPct: 0,
        widthPct: 0,
      };
    }
    const widthPct = Math.max((stage.ms / totalMs) * 100, MIN_BAR_PCT);
    const offsetPct = clamp(((stage.startedAt - origin) / totalMs) * 100, 0, 100 - widthPct);
    return { stage: stage.stage, ms: stage.ms, outcome: stage.outcome, offsetPct, widthPct };
  });

  const firstTokenPct =
    ttftMs === null || ttftMs === undefined ? null : clamp((ttftMs / totalMs) * 100, 0, 100);

  return { totalMs, rows, firstTokenPct };
};
