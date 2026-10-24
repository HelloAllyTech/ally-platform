import React, { useMemo } from "react";

import { formatMs } from "@components/ally-guide/allyGuideFormat";
import { en } from "@constants";
import { AllyGuideStageOutcome, AllyGuideStageTiming } from "@types";

import { buildWaterfall } from "./waterfall";

const BAR_CLASSES: Record<AllyGuideStageOutcome, string> = {
  ok: "bg-primary-500",
  stopped: "bg-warning-300",
  error: "bg-destructive-500",
  skipped: "bg-transparent",
};

const ROW_CLASSES =
  "grid grid-cols-[minmax(96px,160px)_1fr_minmax(88px,auto)] items-center gap-3 text-xs";

interface StageWaterfallProps {
  stages: AllyGuideStageTiming[];
  ttftMs: number | null;
}

/**
 * A turn's stages as bars on one shared time scale: each starts when its stage started and is as wide
 * as it took, so the slow one is the wide one. A "first token" row carries a tick at the moment the
 * first word reached the learner, on the same scale. The bars are for the eye; every row also says
 * its name, duration and outcome in text, because a stage that stopped the turn or failed must not
 * be told by colour alone.
 */
export const StageWaterfall: React.FC<StageWaterfallProps> = ({ stages, ttftMs }) => {
  const strings = en.allyConsole.inspector;
  const waterfall = useMemo(() => buildWaterfall(stages, ttftMs), [stages, ttftMs]);

  if (waterfall.rows.length === 0) {
    return <p className="text-sm text-typography-700">{strings.noStages}</p>;
  }

  return (
    <ol
      className="flex flex-col gap-1.5"
      aria-label={strings.stagesHeading}
      data-testid="stage-waterfall"
    >
      {waterfall.firstTokenPct !== null && (
        <li className={ROW_CLASSES} data-testid="first-token-row">
          <span className="truncate text-typography-700">{strings.firstToken}</span>
          <div className="relative h-3 bg-neutral-50" aria-hidden="true">
            <div
              className="absolute -top-0.5 h-4 w-0.5 bg-typography-900"
              style={{ left: `${waterfall.firstTokenPct}%` }}
              data-testid="first-token-marker"
            />
          </div>
          <span className="whitespace-nowrap tabular-nums text-typography-700">
            {formatMs(ttftMs)}
          </span>
        </li>
      )}
      {waterfall.rows.map((row, index) => {
        const outcomeLabel = strings.stageOutcomes[row.outcome] ?? row.outcome;
        return (
          <li key={`${row.stage}-${index}`} className={ROW_CLASSES} data-testid="stage-row">
            <span className="truncate font-mono text-typography-900" title={row.stage}>
              {row.stage}
            </span>
            <div className="relative h-3 bg-neutral-50" aria-hidden="true">
              {row.widthPct > 0 && (
                <div
                  className={`absolute top-0 h-3 ${BAR_CLASSES[row.outcome]}`}
                  style={{ left: `${row.offsetPct}%`, width: `${row.widthPct}%` }}
                  data-testid="stage-bar"
                />
              )}
            </div>
            <span className="whitespace-nowrap tabular-nums text-typography-700">
              {row.outcome === "skipped" ? outcomeLabel : `${formatMs(row.ms)} · ${outcomeLabel}`}
            </span>
          </li>
        );
      })}
    </ol>
  );
};
