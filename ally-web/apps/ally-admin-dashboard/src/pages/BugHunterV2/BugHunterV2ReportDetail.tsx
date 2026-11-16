import { FC } from "react";

import { Link, useParams } from "react-router-dom";

import { InlineLoading, Tag } from "@ally-ui-mono/ui-shared";
import { useGetBugHunterV2ReportQuery } from "@api";
import { en, ROUTES } from "@constants";
import { formatDateTime } from "@utils";

import { VerdictForm } from "./VerdictForm";

/** A unified diff, line by line: additions green, removals red, hunks grey. */
const UnifiedDiff: FC<{ diff: string }> = ({ diff }) => (
  <pre className="max-h-[480px] overflow-auto rounded border border-neutral-200 bg-neutral-50 p-2 text-xs leading-5">
    {diff.split("\n").map((line, i) => {
      const cls =
        line.startsWith("+++") || line.startsWith("---")
          ? "text-typography-500"
          : line.startsWith("+")
            ? "bg-green-50 text-support-success"
            : line.startsWith("-")
              ? "bg-red-50 text-support-error"
              : line.startsWith("@@")
                ? "text-typography-400"
                : "text-typography-800";
      return (
        <div key={i} className={cls}>
          {line || " "}
        </div>
      );
    })}
  </pre>
);

const Section: FC<{ title: string; children: React.ReactNode; help?: string }> = ({
  title,
  children,
  help,
}) => (
  <section className="flex flex-col gap-2">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-typography-500">{title}</h2>
    {help && <p className="text-xs text-typography-500">{help}</p>}
    {children}
  </section>
);

/** One Bug Hunter v2 report: finding, failing test, patch, reviewer, verdicts. */
export const BugHunterV2ReportDetail: FC = () => {
  const strings = en.bugHunterV2;
  const { id } = useParams();
  const reportId = Number(id);
  const {
    data: r,
    isLoading,
    isError,
  } = useGetBugHunterV2ReportQuery(reportId, {
    skip: !Number.isFinite(reportId),
  });

  if (isLoading) return <InlineLoading />;
  if (isError || !r) {
    return (
      <p className="p-6 text-sm text-support-error" role="alert">
        {strings.loadError}
      </p>
    );
  }
  const current = r.verdicts.find(v => v.active) ?? null;
  const evidence = r.finding?.evidence ?? [];

  return (
    <div className="flex max-w-5xl flex-col gap-6 p-6" data-testid="bug-hunter-v2-report">
      <Link to={ROUTES.BUG_HUNTER_V2} className="text-sm text-primary-600">
        ← {strings.back}
      </Link>
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-typography-900">{r.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-typography-600">
          <Tag type={r.status === "suggested_fix" ? "green" : "purple"} size="sm">
            {strings.outcomes[r.status as keyof typeof strings.outcomes] ?? r.status}
          </Tag>
          <span>{r.app}</span>
          <span>· {strings.sources[r.source as keyof typeof strings.sources] ?? r.source}</span>
          {r.severity && <span>· {r.severity}</span>}
          {r.confidence && (
            <span>
              · {strings.columns.confidence.toLowerCase()} {r.confidence}
            </span>
          )}
          {r.riskLevel && <span>· risk {r.riskLevel}</span>}
          <span>· {formatDateTime(r.createdAt)}</span>
        </div>
      </header>

      <Section title={strings.sections.finding}>
        {r.finding?.hypothesis && (
          <p className="text-sm text-typography-800">{r.finding.hypothesis}</p>
        )}
        {evidence.length > 0 && (
          <ul className="list-disc pl-5 text-sm text-typography-700">
            {evidence.map(e => (
              <li key={e}>
                <code className="text-xs">{e}</code>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {r.rootCause && (
        <Section title={strings.sections.rootCause}>
          <p className="text-sm text-typography-800">{r.rootCause}</p>
        </Section>
      )}

      {r.repro && (
        <Section title={strings.sections.repro} help={strings.sections.reproHelp}>
          <code className="text-xs text-typography-700">
            {r.repro.test_path}::{r.repro.test_name}
          </code>
          {r.repro.source && (
            <pre className="max-h-[320px] overflow-auto rounded border border-neutral-200 bg-neutral-50 p-2 text-xs">
              {r.repro.source}
            </pre>
          )}
          {r.repro.failure_excerpt && (
            <details>
              <summary className="cursor-pointer text-xs text-typography-500">
                {strings.sections.failure}
              </summary>
              <pre className="mt-1 max-h-[240px] overflow-auto rounded bg-neutral-50 p-2 text-xs">
                {r.repro.failure_excerpt}
              </pre>
            </details>
          )}
        </Section>
      )}

      <Section title={strings.sections.patch}>
        {r.patchDiff ? (
          <UnifiedDiff diff={r.patchDiff} />
        ) : (
          <p className="text-sm text-typography-500">{strings.sections.noPatch}</p>
        )}
      </Section>

      {r.review && (
        <Section title={strings.sections.review}>
          <p className="text-sm text-typography-700">
            {r.review.verdict}
            {r.review.disputed ? " · counterexample disputed" : ""}
          </p>
          {(r.review.notes ?? []).length > 0 && (
            <ul className="list-disc pl-5 text-sm text-typography-700">
              {(r.review.notes ?? []).map(n => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {r.stopReason && (
        <Section title={strings.sections.stopReason}>
          <p className="text-sm text-typography-700">{r.stopReason}</p>
        </Section>
      )}

      <VerdictForm reportId={r.id} hasPatch={Boolean(r.patchDiff)} current={current} />

      {r.verdicts.length > 0 && (
        <Section title={strings.sections.history}>
          <ul className="flex flex-col gap-2 text-sm">
            {r.verdicts.map(v => (
              <li key={v.id} className={v.active ? "text-typography-900" : "text-typography-400"}>
                <span className="font-medium">
                  {strings.verdict.diagnoses[v.diagnosis]} · {strings.verdict.fixes[v.fix]}
                </span>{" "}
                — {v.reason}{" "}
                <span className="text-xs">
                  ({v.active ? strings.verdict.current : strings.verdict.superseded},{" "}
                  {strings.verdict.by} #{v.decidedBy}, {formatDateTime(v.decidedAt)})
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
};

export default BugHunterV2ReportDetail;
