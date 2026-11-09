import React, { useCallback, useRef, useState } from "react";

import {
  Archive,
  ArrowUp,
  Check,
  CircleDot,
  CircleOff,
  FilePlus2,
  Merge,
  PenLine,
  Plus,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Tooltip } from "@ally-ui-mono/ui-shared";
import {
  useDismissContextGapMutation,
  useGetContextChangesQuery,
  useGetContextInsightsQuery,
  useGetContextUseCasesQuery,
  useUndoContextChangeMutation,
} from "@api";
import { en } from "@constants";
import {
  ContextCollection,
  ContextGapTopic,
  ContextInsights,
  ContextLoopChange,
  ContextNeverUseful,
} from "@types";

import { capitalise, errorReason, humanise } from "./contextLibraryFormat";
import { InlineError, LoadingRows, OriginBadge, StatusWord } from "./ContextLibraryUi";
import {
  CHANGES_PAGE,
  changeHeadline,
  formatDay,
  formatPercent,
  formatScore,
  gapAction,
  judgeIdle,
  loopName,
  mayHaveMore,
  oldestChange,
  sampleRatePercent,
  weeklyLines,
  weeklySpark,
} from "./insightsFormat";
import { KpiTile, MIN_N_FOR_SCORE } from "../Analytics/chartKit";

interface InsightsViewProps {
  collection?: ContextCollection;
  collections: ContextCollection[];
  canEdit: boolean;
  onPickCollection: (id: string) => void;
  /** Opens the existing add-documents flow (the file picker, then where to add them). */
  onUpload: () => void;
  /** Opens the existing new-entry sheet. */
  onNewEntry: () => void;
  onOpenChunk: (code: string) => void;
}

const ACTION_ICON: Record<string, LucideIcon> = {
  archive: Archive,
  demote: ShieldAlert,
  promote: ArrowUp,
  learn_query: Search,
  merge: Merge,
  promote_setup: SlidersHorizontal,
  rollback_setup: Undo2,
  // The agent curator (Builder Lessons, Bug Hunter Notes).
  agree: Check,
  edit: PenLine,
  add: Plus,
  remove: Archive,
  retire: CircleOff,
};

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500";
const quietButton = `inline-flex min-h-[32px] items-center gap-1.5 rounded border border-border-light bg-white px-3 text-sm hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;

const SectionHeading: React.FC<{ id: string; title: string; intro?: string }> = ({
  id,
  title,
  intro,
}) => (
  <div className="mb-3">
    <h2 id={id} tabIndex={-1} className="text-base font-semibold text-typography-900">
      {title}
    </h2>
    {intro && <p className="max-w-3xl text-sm text-typography-600">{intro}</p>}
  </div>
);

/**
 * Insights for one collection: is it helping, what's missing, what changed (with Undo), and
 * written entries that never help, for their owners. The system reports what it did; nothing
 * here asks anyone to grade.
 */
export const InsightsView: React.FC<InsightsViewProps> = props => {
  const { collection, collections, onPickCollection } = props;
  const strings = en.contextLibrary.insights;

  if (!collection) {
    return (
      <div className="space-y-3 py-6" data-testid="cl-insights">
        <p className="text-sm text-typography-700">{strings.pickCollection}</p>
        <ul className="flex flex-wrap gap-2">
          {collections.map(c => (
            <li key={c.id}>
              <button type="button" className={quietButton} onClick={() => onPickCollection(c.id)}>
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return <CollectionInsights {...props} collection={collection} />;
};

const CollectionInsights: React.FC<InsightsViewProps & { collection: ContextCollection }> = ({
  collection,
  canEdit,
  onUpload,
  onNewEntry,
  onOpenChunk,
}) => {
  const { data, isLoading, isError, error, refetch } = useGetContextInsightsQuery({
    collectionId: collection.id,
    days: 30,
  });

  if (isLoading) return <LoadingRows />;
  if (isError || !data) {
    return (
      <InlineError
        what={en.contextLibrary.views.insights.toLowerCase()}
        reason={errorReason(error)}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="space-y-10 py-2" data-testid="cl-insights">
      <p className="text-xs text-typography-600">
        {en.contextLibrary.insights.window(data.days ?? 30)}
      </p>
      <HelpingSection insights={data} collection={collection} />
      <MissingSection
        gaps={data.missing ?? []}
        collection={collection}
        canEdit={canEdit}
        onUpload={onUpload}
        onNewEntry={onNewEntry}
      />
      <ChangesSection
        key={collection.id}
        first={data.changes ?? []}
        collection={collection}
        canEdit={canEdit}
        onOpenChunk={onOpenChunk}
      />
      <OwnersSection
        entries={data.forOwners ?? []}
        collection={collection}
        onOpenChunk={onOpenChunk}
      />
    </div>
  );
};

/* ── Is it helping? ────────────────────────────────────────────────────── */

const HelpingSection: React.FC<{ insights: ContextInsights; collection: ContextCollection }> = ({
  insights,
  collection,
}) => {
  const strings = en.contextLibrary.insights.helping;
  const { helping, settings } = insights;
  const days = insights.days ?? 30;
  const { data: useCases } = useGetContextUseCasesQuery();
  const labelOfUseCase = (id: string) =>
    useCases?.find(u => u.useCase === id)?.label ?? humanise(id);
  const nothingJudged = !helping.judgedResults;
  const lines = weeklyLines(helping.weekly);

  return (
    <section aria-labelledby="cl-helping" data-testid="cl-helping">
      <SectionHeading id="cl-helping" title={strings.heading} />
      {nothingJudged ? (
        <div
          className="max-w-3xl rounded border border-dashed border-border-light px-4 py-4"
          data-testid="cl-helping-empty"
        >
          <p className="text-sm font-medium text-typography-900">{strings.noneJudgedTitle}</p>
          <p className="text-sm text-typography-600">
            {judgeIdle(settings)
              ? strings.judgePaused
              : strings.noneJudged(sampleRatePercent(settings?.judgeSampleRate))}
          </p>
        </div>
      ) : (
        <>
          <div className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
            <KpiTile
              label={strings.precision}
              description={strings.precisionHelp(collection.nounPlural)}
              value={formatPercent(helping.precision)}
              n={helping.judgedResults}
              nUnit={strings.precisionUnit}
              minN={MIN_N_FOR_SCORE}
              spark={weeklySpark(helping.weekly)}
            />
            <KpiTile
              label={strings.holdout}
              description={strings.holdoutHelp}
              value={formatScore(helping.holdoutNdcg)}
              n={helping.holdoutSearches}
              nUnit={strings.holdoutUnit}
              minN={MIN_N_FOR_SCORE}
            />
          </div>
          {lines.length > 0 && (
            <div className="sr-only">
              <p>{strings.weeklyLabel}</p>
              <ul>
                {lines.map(line => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <h3 className="mb-1 mt-6 text-sm font-semibold text-typography-900">
        {strings.usageHeading}
      </h3>
      {helping.byUseCase?.length ? (
        <div className="overflow-x-auto">
          <table className="text-left text-sm" data-testid="cl-usage-table">
            <caption className="mb-2 text-left text-xs text-typography-600">
              {strings.usageCaption(collection.nounPlural)}
            </caption>
            <thead>
              <tr className="border-b border-border-light text-xs text-typography-600">
                <th scope="col" className="py-2 pr-6 font-medium">
                  {strings.columns.useCase}
                </th>
                {(["surfaced", "read", "cited", "applied"] as const).map(column => (
                  <th key={column} scope="col" className="px-3 py-2 text-right font-medium">
                    {strings.columns[column]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {helping.byUseCase.map(row => (
                <tr key={row.useCase} className="border-b border-border-light">
                  <th scope="row" className="py-2 pr-6 font-normal text-typography-900">
                    {labelOfUseCase(row.useCase)}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums">{row.surfaced}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.read}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.cited}
                    {row.rejectedCitations > 0 && (
                      <Tooltip label={strings.rejectedHelp} align="top">
                        <span
                          tabIndex={0}
                          className="ml-1 text-xs text-amber-700"
                          aria-label={`${strings.rejected(row.rejectedCitations)}. ${strings.rejectedHelp}`}
                        >
                          ({strings.rejected(row.rejectedCitations)})
                        </span>
                      </Tooltip>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.applied}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-typography-600">{strings.noUsage(days)}</p>
      )}
    </section>
  );
};

/* ── What's missing? ───────────────────────────────────────────────────── */

const MissingSection: React.FC<{
  gaps: ContextGapTopic[];
  collection: ContextCollection;
  canEdit: boolean;
  onUpload: () => void;
  onNewEntry: () => void;
}> = ({ gaps, collection, canEdit, onUpload, onNewEntry }) => {
  const strings = en.contextLibrary.insights.missing;
  const [dismissGap] = useDismissContextGapMutation();
  // Hidden here ahead of the server; put back if it refuses.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const headingRef = useRef<HTMLDivElement>(null);
  const shown = gaps.filter(gap => !hidden.has(gap.id));

  const dismiss = async (gap: ContextGapTopic) => {
    setHidden(previous => new Set(previous).add(gap.id));
    headingRef.current?.querySelector<HTMLElement>("h2")?.focus();
    try {
      await dismissGap({ gapId: gap.id }).unwrap();
      toast(strings.dismissed(gap.label));
    } catch {
      setHidden(previous => {
        const next = new Set(previous);
        next.delete(gap.id);
        return next;
      });
      toast.error(en.contextLibrary.sheet.toasts.failed);
    }
  };

  return (
    <section aria-labelledby="cl-missing" data-testid="cl-missing">
      <div ref={headingRef}>
        <SectionHeading id="cl-missing" title={strings.heading} intro={strings.intro} />
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-typography-600">{strings.none}</p>
      ) : (
        <ul className="divide-y divide-border-light border-y border-border-light">
          {shown.map(gap => {
            const action = canEdit ? gapAction(gap, collection) : null;
            return (
              <li
                key={gap.id}
                className="flex flex-wrap items-start gap-3 py-3"
                data-testid="cl-gap"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-typography-900">{gap.label}</p>
                  <p className="text-xs text-typography-600">
                    {[strings.searches(gap.queryCount), formatDay(gap.lastSeenAt)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {gap.exampleQueries?.length > 0 && (
                    <p className="mt-1 text-xs text-typography-700">
                      <span className="text-typography-600">{strings.askedAs} </span>
                      {gap.exampleQueries
                        .slice(0, 3)
                        .map(q => `“${q}”`)
                        .join(", ")}
                    </p>
                  )}
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center gap-2">
                    {action === "upload" && (
                      <button type="button" className={quietButton} onClick={onUpload}>
                        <FilePlus2 size={14} aria-hidden /> {strings.upload}
                      </button>
                    )}
                    {action === "entry" && (
                      <button type="button" className={quietButton} onClick={onNewEntry}>
                        <PenLine size={14} aria-hidden />{" "}
                        {capitalise(strings.addEntries(collection.nounPlural))}
                      </button>
                    )}
                    <button
                      type="button"
                      className={quietButton}
                      aria-label={strings.dismissLabel(gap.label)}
                      onClick={() => void dismiss(gap)}
                    >
                      <X size={14} aria-hidden /> {strings.dismiss}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

/* ── What changed? ─────────────────────────────────────────────────────── */

const ChangesSection: React.FC<{
  first: ContextLoopChange[];
  collection: ContextCollection;
  canEdit: boolean;
  onOpenChunk: (code: string) => void;
}> = ({ first, collection, canEdit, onOpenChunk }) => {
  const strings = en.contextLibrary.insights.changes;
  const [undoChange] = useUndoContextChangeMutation();
  // Undone here ahead of the server; dropped again if it refuses.
  const [undone, setUndone] = useState<Record<string, true>>({});
  // Each "Show more" adds a page that starts before the oldest change shown so far.
  const [cursors, setCursors] = useState<string[]>([]);

  const undo = useCallback(
    async (change: ContextLoopChange) => {
      setUndone(previous => ({ ...previous, [change.id]: true }));
      try {
        await undoChange({ actionId: change.id }).unwrap();
        toast(strings.undoneToast);
      } catch (error) {
        setUndone(previous => {
          const next = { ...previous };
          delete next[change.id];
          return next;
        });
        const reason = errorReason(error);
        toast.error(reason ? `${strings.undoFailed} ${reason}` : strings.undoFailed);
      }
    },
    [strings.undoFailed, strings.undoneToast, undoChange],
  );

  const more = (from: string | undefined) => {
    if (from) setCursors(previous => (previous.includes(from) ? previous : [...previous, from]));
  };

  const rowProps = { collection, canEdit, undone, onUndo: undo, onOpenChunk };

  return (
    <section aria-labelledby="cl-changes" data-testid="cl-changes">
      <SectionHeading
        id="cl-changes"
        title={strings.heading}
        intro={strings.intro(collection.noun)}
      />
      {first.length === 0 ? (
        <p className="text-sm text-typography-600">{strings.none}</p>
      ) : (
        <>
          <ul className="divide-y divide-border-light border-y border-border-light">
            {first.map(change => (
              <ChangeRow key={change.id} change={change} {...rowProps} />
            ))}
            {cursors.map((before, i) => (
              <ChangesPage
                key={before}
                before={before}
                isLast={i === cursors.length - 1}
                onMore={more}
                {...rowProps}
              />
            ))}
          </ul>
          {cursors.length === 0 && mayHaveMore(first) && (
            <ShowMore onClick={() => more(oldestChange(first))} />
          )}
        </>
      )}
    </section>
  );
};

type RowProps = {
  collection: ContextCollection;
  canEdit: boolean;
  undone: Record<string, true>;
  onUndo: (change: ContextLoopChange) => void;
  onOpenChunk: (code: string) => void;
};

const ShowMore: React.FC<{ onClick: () => void; loading?: boolean }> = ({ onClick, loading }) => (
  <button
    type="button"
    className={`${quietButton} mt-3`}
    onClick={onClick}
    disabled={loading}
    data-testid="cl-changes-more"
  >
    {loading
      ? en.contextLibrary.insights.changes.loadingMore
      : en.contextLibrary.insights.changes.showMore}
  </button>
);

/** One older page of the feed, fetched with `before`. Rendered inside the feed's list. */
const ChangesPage: React.FC<
  RowProps & { before: string; isLast: boolean; onMore: (from: string | undefined) => void }
> = ({ before, isLast, onMore, ...rowProps }) => {
  const { data, isLoading, isError, error, refetch } = useGetContextChangesQuery({
    collectionId: rowProps.collection.id,
    before,
    limit: CHANGES_PAGE,
  });
  if (isLoading) {
    return (
      <li className="py-3">
        <LoadingRows rows={2} />
      </li>
    );
  }
  if (isError) {
    return (
      <li className="py-3">
        <InlineError
          what={en.contextLibrary.insights.changes.heading.toLowerCase()}
          reason={errorReason(error)}
          onRetry={() => void refetch()}
        />
      </li>
    );
  }
  const page = data ?? [];
  return (
    <>
      {page.map(change => (
        <ChangeRow key={change.id} change={change} {...rowProps} />
      ))}
      {isLast && mayHaveMore(page) && (
        <li className="list-none">
          <ShowMore onClick={() => onMore(oldestChange(page))} />
        </li>
      )}
    </>
  );
};

const ChangeRow: React.FC<RowProps & { change: ContextLoopChange }> = ({
  change,
  collection,
  canEdit,
  undone,
  onUndo,
  onOpenChunk,
}) => {
  const strings = en.contextLibrary.insights.changes;
  const rowRef = useRef<HTMLLIElement>(null);
  const isUndone = Boolean(change.undoneAt) || Boolean(undone[change.id]);
  const headline = changeHeadline(change, collection.noun);
  const Icon = ACTION_ICON[change.action] ?? CircleDot;

  return (
    <li
      ref={rowRef}
      tabIndex={-1}
      className="flex flex-wrap items-start gap-3 py-3 focus:outline-none"
      data-testid="cl-change"
    >
      <Icon size={16} aria-hidden className="mt-0.5 shrink-0 text-typography-600" />
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${isUndone ? "text-typography-600" : "text-typography-900"}`}>
          {change.code ? (
            <>
              {headline.split(change.code)[0]}
              <button
                type="button"
                onClick={() => onOpenChunk(change.code as string)}
                className={`font-mono text-primary-700 underline-offset-2 hover:underline ${focusRing}`}
              >
                {change.code}
              </button>
              {headline.split(change.code).slice(1).join(change.code)}
            </>
          ) : (
            headline
          )}
        </p>
        {change.reason && <p className="text-xs text-typography-600">{change.reason}</p>}
        <p className="text-xs text-typography-500">
          {[loopName(change.loop), formatDay(change.createdAt)].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="shrink-0">
        {isUndone ? (
          <StatusWord icon={Undo2} label={strings.undone} testId="cl-change-undone" />
        ) : (
          canEdit &&
          change.canUndo && (
            <button
              type="button"
              className={quietButton}
              aria-label={strings.undoLabel(headline)}
              onClick={() => {
                // The button is about to go: keep focus on its row, not the page.
                rowRef.current?.focus();
                onUndo(change);
              }}
              data-testid="cl-change-undo"
            >
              <Undo2 size={14} aria-hidden /> {strings.undo}
            </button>
          )
        )}
      </div>
    </li>
  );
};

/* ── For owners ────────────────────────────────────────────────────────── */

const OwnersSection: React.FC<{
  entries: ContextNeverUseful[];
  collection: ContextCollection;
  onOpenChunk: (code: string) => void;
}> = ({ entries, collection, onOpenChunk }) => {
  const strings = en.contextLibrary.insights.owners;
  return (
    <section aria-labelledby="cl-owners" data-testid="cl-owners">
      <SectionHeading
        id="cl-owners"
        title={strings.heading}
        intro={strings.intro(collection.nounPlural)}
      />
      {entries.length === 0 ? (
        <p className="text-sm text-typography-600">{strings.none(collection.nounPlural)}</p>
      ) : (
        <ul className="divide-y divide-border-light border-y border-border-light">
          {entries.map(entry => (
            <li key={entry.code} className="py-3" data-testid="cl-owner-entry">
              <button
                type="button"
                onClick={() => onOpenChunk(entry.code)}
                className={`block w-full rounded text-left text-sm text-typography-900 hover:underline ${focusRing}`}
              >
                {entry.statement}
              </button>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-typography-600">
                <span className="font-mono">{entry.code}</span>
                <OriginBadge origin={entry.origin} />
                <span>{strings.stats(entry.surfaced, entry.judgedOffTopic, entry.judged)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
