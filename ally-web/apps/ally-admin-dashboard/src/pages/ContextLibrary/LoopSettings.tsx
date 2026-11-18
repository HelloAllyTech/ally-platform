import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Check, Pause, Play, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import {
  useGetContextLoopSettingsQuery,
  useRunContextLoopsMutation,
  useSetContextLoopSettingsMutation,
} from "@api";
import { TooltipIcon } from "@assets";
import { en } from "@constants";
import { ContextCollection, ContextLoopSettings } from "@types";

import { UNDO_MS } from "./ChunkSheet";
import { errorReason } from "./contextLibraryFormat";
import { InlineError, LoadingRows, StatusWord } from "./ContextLibraryUi";
import {
  formatDay,
  isLoopOn,
  loopName,
  sampleRatePercent,
  setupRows,
  withLoop,
} from "./insightsFormat";

/** Wait this long after the last move of the sample-rate slider before saving it. */
const SAMPLE_RATE_SAVE_MS = 600;

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500";
const quietButton = `inline-flex min-h-[32px] items-center gap-1.5 rounded border border-border-light bg-white px-3 text-sm hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;

const Help: React.FC<{ label: string }> = ({ label }) => (
  <Tooltip label={label} align="top">
    <button type="button" className="inline-flex cursor-pointer items-center" aria-label={label}>
      <TooltipIcon />
    </button>
  </Tooltip>
);

/**
 * One collection's learning loops: a switch per loop (on means not paused), the judge's sample
 * rate, the search setup in force, and Run now. Read-only without the edit grant, like the
 * grants matrix.
 */
export const LoopSettings: React.FC<{ collection?: ContextCollection; canEdit: boolean }> = ({
  collection,
  canEdit,
}) => {
  const strings = en.contextLibrary.settings.loops;
  if (!collection) {
    return (
      <section className="space-y-2" data-testid="cl-loops">
        <h2 className="text-base font-semibold">{strings.title}</h2>
        <p className="text-sm text-typography-600">{strings.pick}</p>
      </section>
    );
  }
  return <CollectionLoops key={collection.id} collection={collection} canEdit={canEdit} />;
};

const CollectionLoops: React.FC<{ collection: ContextCollection; canEdit: boolean }> = ({
  collection,
  canEdit,
}) => {
  const strings = en.contextLibrary.settings.loops;
  const { data, isLoading, isError, error, refetch } = useGetContextLoopSettingsQuery(
    collection.id,
  );
  const [save] = useSetContextLoopSettingsMutation();
  const [run, { isLoading: running }] = useRunContextLoopsMutation();

  // Ahead of the server: the paused list and the slider, until fresh settings arrive.
  const [pausedDraft, setPausedDraft] = useState<string[] | null>(null);
  const [rateDraft, setRateDraft] = useState<number | null>(null);
  useEffect(() => {
    setPausedDraft(null);
    setRateDraft(null);
  }, [data]);

  const settings: ContextLoopSettings | undefined = useMemo(
    () => (data ? { ...data, paused: pausedDraft ?? data.paused } : undefined),
    [data, pausedDraft],
  );

  const flipRef = useRef<(loop: string, on: boolean, undoable: boolean) => Promise<void>>();
  const flip = useCallback(
    async (loop: string, on: boolean, undoable: boolean) => {
      if (!settings) return;
      const next = withLoop(settings.paused, loop, on);
      setPausedDraft(next);
      try {
        await save({ collectionId: collection.id, patch: { paused: next } }).unwrap();
        const message = strings.toggled(loopName(loop), collection.name, on);
        if (undoable) {
          toast(message, {
            duration: UNDO_MS,
            action: {
              label: en.contextLibrary.sheet.toasts.undo,
              onClick: () => void flipRef.current?.(loop, !on, false),
            },
          });
        } else {
          toast(en.contextLibrary.sheet.toasts.undone);
        }
      } catch {
        setPausedDraft(null);
        toast.error(en.contextLibrary.sheet.toasts.failed);
      }
    },
    [collection.id, collection.name, save, settings, strings],
  );
  flipRef.current = flip;

  const rateTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(rateTimer.current), []);
  const changeRate = (percent: number) => {
    setRateDraft(percent);
    clearTimeout(rateTimer.current);
    rateTimer.current = setTimeout(async () => {
      try {
        await save({
          collectionId: collection.id,
          patch: { judgeSampleRate: percent / 100 },
        }).unwrap();
        toast(strings.sampleRateSaved(percent, collection.name));
      } catch {
        setRateDraft(null);
        toast.error(en.contextLibrary.sheet.toasts.failed);
      }
    }, SAMPLE_RATE_SAVE_MS);
  };

  const runNow = async (kind: "nightly" | "tuning") => {
    try {
      await run({ collectionId: collection.id, kind }).unwrap();
      toast(strings.run.started);
    } catch {
      toast.error(strings.run.failed);
    }
  };

  if (isLoading) return <LoadingRows rows={3} />;
  if (isError || !settings) {
    return (
      <InlineError
        what={strings.heading(collection.name)}
        reason={errorReason(error)}
        onRetry={() => void refetch()}
      />
    );
  }

  const percent = rateDraft ?? sampleRatePercent(settings.judgeSampleRate);
  const setup = settings.searchSetup;

  return (
    <section className="space-y-4" aria-labelledby="cl-loops-heading" data-testid="cl-loops">
      <div>
        <h2 id="cl-loops-heading" className="text-base font-semibold">
          {strings.heading(collection.name)}
        </h2>
        <p className="max-w-3xl text-sm text-typography-600">{strings.intro}</p>
      </div>

      <ul className="max-w-3xl divide-y divide-border-light border-y border-border-light">
        {settings.loops.map(loop => {
          const on = isLoopOn(settings, loop);
          const name = loopName(loop);
          return (
            <li key={loop} className="flex items-center gap-4 py-2" data-testid="cl-loop-row">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-typography-900">{name}</p>
                <p className="text-xs text-typography-600">{strings.help[loop] ?? ""}</p>
              </div>
              {canEdit ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={strings.switchLabel(name)}
                  onClick={() => void flip(loop, !on, true)}
                  className={`inline-flex items-center gap-2 rounded px-1 py-1 text-xs ${focusRing}`}
                  data-testid="cl-loop-switch"
                >
                  <span
                    aria-hidden
                    className={`relative inline-block h-4 w-7 rounded-full transition-colors motion-reduce:transition-none ${
                      on ? "bg-green-600" : "bg-neutral-300"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all motion-reduce:transition-none ${
                        on ? "left-3.5" : "left-0.5"
                      }`}
                    />
                  </span>
                  {on ? strings.on : strings.paused}
                </button>
              ) : (
                <StatusWord
                  icon={on ? Check : Pause}
                  tone={on ? "good" : "muted"}
                  label={on ? strings.on : strings.paused}
                />
              )}
            </li>
          );
        })}
      </ul>

      <div className="max-w-3xl space-y-1">
        <div className="flex items-center gap-1">
          <label htmlFor="cl-sample-rate" className="text-sm font-medium text-typography-900">
            {strings.sampleRate}
          </label>
          <Help label={strings.sampleRateHelp} />
        </div>
        {canEdit ? (
          <div className="flex items-center gap-3">
            <input
              id="cl-sample-rate"
              type="range"
              min={0}
              max={100}
              step={1}
              value={percent}
              aria-valuetext={strings.sampleRateValue(percent)}
              onChange={event => changeRate(Number(event.target.value))}
              className="w-64 accent-primary-600"
              data-testid="cl-sample-rate"
            />
            <span className="text-sm tabular-nums text-typography-700">
              {strings.sampleRateValue(percent)}
            </span>
          </div>
        ) : (
          <p id="cl-sample-rate" className="text-sm text-typography-700">
            {strings.sampleRateValue(percent)}
          </p>
        )}
      </div>

      <div className="max-w-3xl space-y-1" data-testid="cl-search-setup">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-typography-900">
          <SlidersHorizontal size={14} aria-hidden />
          {strings.setup.heading}
        </h3>
        {setup ? (
          <>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
              {setupRows(setup).map(row => (
                <React.Fragment key={row.label}>
                  <dt className="flex items-center gap-1 text-typography-600">
                    {row.label}
                    {row.label === strings.setup.diversity && (
                      <Help label={strings.setup.diversityHelp} />
                    )}
                    {row.label === strings.setup.fusion && (
                      <Help label={strings.setup.fusionHelp} />
                    )}
                  </dt>
                  <dd className="tabular-nums text-typography-900">{row.value}</dd>
                </React.Fragment>
              ))}
            </dl>
            <p className="text-xs text-typography-600">
              {settings.searchSetupIsDefault || !settings.setupPromotedAt
                ? strings.setup.isDefault
                : strings.setup.changed(formatDay(settings.setupPromotedAt))}
            </p>
          </>
        ) : (
          <p className="text-sm text-typography-600">{strings.setup.none}</p>
        )}
      </div>

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={quietButton}
            disabled={running}
            onClick={() => void runNow("nightly")}
            data-testid="cl-run-nightly"
          >
            <Play size={14} aria-hidden /> {strings.run.nightly}
          </button>
          <button
            type="button"
            className={quietButton}
            disabled={running}
            onClick={() => void runNow("tuning")}
            data-testid="cl-run-tuning"
          >
            <Play size={14} aria-hidden /> {strings.run.tuning}
          </button>
        </div>
      )}
    </section>
  );
};
