import { FC, useState } from "react";

import { useNavigate } from "react-router-dom";

import { InlineLoading, Tag } from "@ally-ui-mono/ui-shared";
import { useGetBugHunterV2ReportsQuery } from "@api";
import { en, ROUTES } from "@constants";
import { BugHunterV2ReportFilter, BugHunterV2ReportItem } from "@types";
import { formatRelativeTime } from "@utils";

const FILTERS: BugHunterV2ReportFilter[] = ["open", "judged", "all"];

/**
 * Bug Hunter v2 → Reports: the suggested fixes and escalations waiting for a verdict.
 * Gated by the route (`bug_hunter_v2_verdicts` toggle) and by ally-be, which 403s
 * without it; this page does no access check of its own.
 */
export const BugHunterV2Reports: FC = () => {
  const strings = en.bugHunterV2;
  const navigate = useNavigate();
  const [status, setStatus] = useState<BugHunterV2ReportFilter>("open");
  const { data, isLoading, isError, error } = useGetBugHunterV2ReportsQuery({ status });
  const unavailable = (error as { status?: number } | undefined)?.status === 503;

  return (
    <div className="flex flex-col gap-4 p-6" data-testid="bug-hunter-v2-reports">
      <div>
        <h1 className="text-xl font-semibold text-typography-900">{strings.title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-typography-600">{strings.intro}</p>
      </div>
      <div className="flex gap-2" role="tablist" aria-label={strings.columns.verdict}>
        {FILTERS.map(f => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={status === f}
            onClick={() => setStatus(f)}
            className={`rounded-full border px-3 py-1 text-sm ${
              status === f
                ? "border-primary-500 bg-primary-50 text-primary-700"
                : "border-neutral-200 text-typography-600"
            }`}
          >
            {strings.filters[f]}
          </button>
        ))}
      </div>
      {isLoading && <InlineLoading />}
      {isError && (
        <p className="text-sm text-support-error" role="alert">
          {unavailable ? strings.unavailable : strings.loadError}
        </p>
      )}
      {data && data.length === 0 && (
        <p className="text-sm text-typography-500">
          {status === "open" ? strings.empty : strings.emptyFiltered}
        </p>
      )}
      {data && data.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-typography-500">
              <th className="py-2 pr-3 font-medium">{strings.columns.title}</th>
              <th className="py-2 pr-3 font-medium">{strings.columns.app}</th>
              <th className="py-2 pr-3 font-medium">{strings.columns.source}</th>
              <th className="py-2 pr-3 font-medium">{strings.columns.outcome}</th>
              <th className="py-2 pr-3 font-medium">{strings.columns.severity}</th>
              <th className="py-2 pr-3 font-medium">{strings.columns.confidence}</th>
              <th className="py-2 pr-3 font-medium">{strings.columns.age}</th>
              <th className="py-2 font-medium">{strings.columns.verdict}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r: BugHunterV2ReportItem) => (
              <tr
                key={r.id}
                className="cursor-pointer border-b border-neutral-100 hover:bg-neutral-50"
                onClick={() => navigate(ROUTES.BUG_HUNTER_V2_REPORT(r.id))}
              >
                <td className="py-2 pr-3 font-medium text-typography-900">{r.title}</td>
                <td className="py-2 pr-3">{r.app}</td>
                <td className="py-2 pr-3">
                  {strings.sources[r.source as keyof typeof strings.sources] ?? r.source}
                </td>
                <td className="py-2 pr-3">
                  <Tag type={r.status === "suggested_fix" ? "green" : "purple"} size="sm">
                    {strings.outcomes[r.status as keyof typeof strings.outcomes] ?? r.status}
                  </Tag>
                </td>
                <td className="py-2 pr-3">{r.severity ?? "–"}</td>
                <td className="py-2 pr-3">{r.confidence ?? "–"}</td>
                <td className="py-2 pr-3 text-typography-500">{formatRelativeTime(r.createdAt)}</td>
                <td className="py-2">
                  {r.verdict
                    ? `${strings.verdict.diagnoses[r.verdict.diagnosis]} · ${
                        strings.verdict.fixes[r.verdict.fix]
                      }`
                    : "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default BugHunterV2Reports;
