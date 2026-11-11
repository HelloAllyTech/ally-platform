import React, { useState } from "react";

import { useSearchParams } from "react-router-dom";

import { Button, Checkbox, Select, SelectItem } from "@ally-ui-mono/ui-shared";
import { useGetExpertReviewQueueQuery } from "@api";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { ExpertQueueFilters, ExpertReviewReason } from "@types";

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

const FilterSelect: React.FC<{
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; text: string }>;
  onChange: (v: string) => void;
}> = ({ id, label, value, options, onChange }) => (
  <Select
    id={id}
    labelText={label}
    value={value}
    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
  >
    <SelectItem value="" text={en.debriefs.expertReview.filters.any} />
    {options.map(o => (
      <SelectItem key={o.value} value={o.value} text={o.text} />
    ))}
  </Select>
);

const Queue: React.FC<{ onOpen: (runId: string) => void }> = ({ onOpen }) => {
  const s = en.debriefs.expertReview;
  const [filters, setFilters] = useState<ExpertQueueFilters>({});
  const queue = useGetExpertReviewQueueQuery(filters, { refetchOnMountOrArgChange: true });
  const set = (patch: Partial<ExpertQueueFilters>) => setFilters(f => ({ ...f, ...patch }));
  const options = queue.data?.filters;
  const typeLabel = (t: string | null) => (t ? (s.sessionTypes[t] ?? t) : "—");

  return (
    <section className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect
          id="expert-filter-org"
          label={s.filters.organisation}
          value={filters.tenantId ?? ""}
          options={(options?.tenants ?? []).map(t => ({ value: t.id, text: t.name }))}
          onChange={v => set({ tenantId: v || undefined })}
        />
        <FilterSelect
          id="expert-filter-language"
          label={s.filters.language}
          value={filters.language ?? ""}
          options={(options?.languages ?? []).map(l => ({ value: l, text: l }))}
          onChange={v => set({ language: v || undefined })}
        />
        <FilterSelect
          id="expert-filter-type"
          label={s.filters.sessionType}
          value={filters.sessionType ?? ""}
          options={(options?.sessionTypes ?? []).map(t => ({ value: t, text: typeLabel(t) }))}
          onChange={v => set({ sessionType: v || undefined })}
        />
        <FilterSelect
          id="expert-filter-reason"
          label={s.filters.reason}
          value={filters.source ?? ""}
          options={REASONS.map(r => ({ value: r, text: s.reasons[r] }))}
          onChange={v => set({ source: (v || undefined) as ExpertReviewReason | undefined })}
        />
      </div>
      <Checkbox
        id="expert-include-reviewed"
        labelText={s.filters.includeReviewed}
        checked={!!filters.includeReviewed}
        onChange={(_e: unknown, { checked }: { checked: boolean }) =>
          set({ includeReviewed: checked || undefined })
        }
      />

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
              item.language ?? "—",
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
