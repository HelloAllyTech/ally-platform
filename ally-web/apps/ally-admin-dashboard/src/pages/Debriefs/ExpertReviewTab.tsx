import React, { useState } from "react";

import { useSearchParams } from "react-router-dom";

import { Button, CarbonDropdown as Dropdown, CarbonToggle } from "@ally-ui-mono/ui-shared";
import { useGetExpertReviewQueueQuery } from "@api";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { ExpertQueueFilters, ExpertReviewReason } from "@types";

import { codeWords, languageLabel } from "./consoleLabels";
import { ConsoleTable, formatWhen, score } from "./consoleTable";
import { ExpertReviewScreen, MyComments } from "./ExpertReviewScreen";

const REASONS: ExpertReviewReason[] = [
  "risk_cue",
  "below_bar",
  "learner_flag",
  "disagreement",
  "sample",
];

/** The open debrief lives in `?review=` beside `?tab=`, so a link opens exactly there. */
const OPEN_PARAM = "review";

type Item = { id: string; label: string };

/** One house filter: a Carbon dropdown with no visible label, its first item "All …". */
const FilterDropdown: React.FC<{
  id: string;
  label: string;
  allLabel: string;
  value: string;
  options: Item[];
  onChange: (v: string) => void;
  width?: string;
}> = ({ id, label, allLabel, value, options, onChange, width = "sm:w-48" }) => {
  const items: Item[] = [{ id: "", label: allLabel }, ...options];
  return (
    <div className={`w-full ${width}`} data-testid={id}>
      <Dropdown
        id={id}
        size="md"
        titleText={label}
        hideLabel
        label={label}
        items={items}
        selectedItem={items.find(i => i.id === value) ?? items[0]}
        itemToString={(item: Item | null) => item?.label ?? ""}
        onChange={({ selectedItem }: { selectedItem: Item | null }) =>
          onChange(selectedItem?.id ?? "")
        }
      />
    </div>
  );
};

const Queue: React.FC<{ onOpen: (runId: string) => void }> = ({ onOpen }) => {
  const s = en.debriefs.expertReview;
  const [filters, setFilters] = useState<ExpertQueueFilters>({});
  const queue = useGetExpertReviewQueueQuery(filters, { refetchOnMountOrArgChange: true });
  const set = (patch: Partial<ExpertQueueFilters>) => setFilters(f => ({ ...f, ...patch }));
  const options = queue.data?.filters;
  const typeLabel = (t: string | null) => (t ? (s.sessionTypes[t] ?? codeWords(t)) : "—");
  const f = s.filters;
  const active = Object.values(filters).some(v => v !== undefined && v !== "");

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3" data-testid="expert-filters">
        <FilterDropdown
          id="expert-filter-org"
          label={f.organisation}
          allLabel={f.allOf.organisation}
          value={filters.tenantId ?? ""}
          options={(options?.tenants ?? []).map(t => ({ id: t.id, label: t.name }))}
          onChange={v => set({ tenantId: v || undefined })}
          width="sm:w-56"
        />
        <FilterDropdown
          id="expert-filter-language"
          label={f.language}
          allLabel={f.allOf.language}
          value={filters.language ?? ""}
          options={(options?.languages ?? []).map(l => ({ id: l, label: languageLabel(l) }))}
          onChange={v => set({ language: v || undefined })}
        />
        <FilterDropdown
          id="expert-filter-type"
          label={f.sessionType}
          allLabel={f.allOf.sessionType}
          value={filters.sessionType ?? ""}
          options={(options?.sessionTypes ?? []).map(t => ({ id: t, label: typeLabel(t) }))}
          onChange={v => set({ sessionType: v || undefined })}
        />
        <FilterDropdown
          id="expert-filter-reason"
          label={f.reason}
          allLabel={f.allOf.reason}
          value={filters.source ?? ""}
          options={REASONS.map(r => ({ id: r, label: s.reasons[r] }))}
          onChange={v => set({ source: (v || undefined) as ExpertReviewReason | undefined })}
        />
        <div className="flex items-center">
          <CarbonToggle
            id="expert-include-reviewed"
            size="sm"
            // With hideLabel, Carbon shows labelText as the side label in both states.
            labelText={f.includeReviewed}
            hideLabel
            toggled={!!filters.includeReviewed}
            onToggle={(on: boolean) => set({ includeReviewed: on || undefined })}
          />
        </div>
        {active && (
          <div className="flex items-center">
            <Button
              kind="ghost"
              size="md"
              data-testid="expert-filter-clear"
              onClick={() => setFilters({})}
            >
              {f.clear}
            </Button>
          </div>
        )}
      </div>

      {queue.isError ? (
        <ErrorPanel what={s.loadFailed} error={queue.error} onRetry={() => void queue.refetch()} />
      ) : !queue.data ? (
        <LoadingBlock lines={5} />
      ) : queue.data.items.length === 0 ? (
        <EmptyPanel title={s.emptyTitle} message={s.emptyMessage} />
      ) : (
        <ConsoleTable
          testId="expert-queue"
          headers={[
            s.columns.when,
            s.columns.organisation,
            s.columns.language,
            s.columns.sessionType,
            s.columns.reasons,
            s.columns.comments,
            s.columns.verdict,
            s.columns.judge,
            <span key="a" className="sr-only">
              {s.open}
            </span>,
          ]}
          rows={queue.data.items.map(item => ({
            key: item.runId,
            testId: "expert-queue-row",
            cells: [
              formatWhen(item.createdAt),
              item.tenantName ?? "—",
              languageLabel(item.language),
              typeLabel(item.sessionType),
              <span key="r" className="flex flex-wrap gap-1">
                {item.reasons.map(r => (
                  <Pill
                    key={r}
                    tone={r === "risk_cue" ? "warning" : "neutral"}
                    title={s.reasonHelp[r]}
                  >
                    {s.reasons[r]}
                  </Pill>
                ))}
              </span>,
              String(item.commentCount),
              item.myVerdict ? (
                <Pill key="v" tone={item.myVerdict === "good" ? "success" : "warning"}>
                  {item.myVerdict === "good" ? s.verdict.good : s.verdict.needsWork}
                </Pill>
              ) : (
                "—"
              ),
              item.myVerdict ? (
                score(item.judgeOverall)
              ) : (
                <span key="j" className="text-typography-700">
                  {s.judgeHidden}
                </span>
              ),
              <Button
                key="o"
                kind="tertiary"
                size="sm"
                aria-label={s.openLabel(formatWhen(item.createdAt))}
                onClick={() => onOpen(item.runId)}
              >
                {s.open}
              </Button>,
            ],
          }))}
        />
      )}
    </section>
  );
};

/**
 * Expert review (debrief orchestrator spec Part B): a queue of debriefs worth an expert's eye, and
 * a review screen where comments land on exact lines. Shown only to holders of "Review debriefs
 * (expert)".
 */
export const ExpertReviewTab: React.FC = () => {
  const s = en.debriefs.expertReview;
  const [searchParams, setSearchParams] = useSearchParams();
  const openRunId = searchParams.get(OPEN_PARAM);
  const setOpen = (runId: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (runId) next.set(OPEN_PARAM, runId);
    else next.delete(OPEN_PARAM);
    setSearchParams(next);
  };

  if (openRunId) {
    return <ExpertReviewScreen key={openRunId} runId={openRunId} onBack={() => setOpen(null)} />;
  }
  return (
    <div className="flex flex-col gap-8" data-testid="expert-review-tab">
      <div>
        <h2 className="text-xl font-normal text-typography-900">{s.heading}</h2>
        <p className="max-w-3xl pt-1 text-sm text-typography-700">{s.help}</p>
      </div>
      <Queue onOpen={runId => setOpen(runId)} />
      <div className="max-w-3xl">
        <MyComments />
      </div>
    </div>
  );
};
