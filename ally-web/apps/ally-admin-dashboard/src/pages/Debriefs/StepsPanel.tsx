import React from "react";

import { useGetDebriefStepsQuery } from "@api";
import { formatMs, formatUsd } from "@components/ally-guide/allyGuideFormat";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en } from "@constants";

import { ConsoleTable } from "./consoleTable";

/**
 * v9 FR-38 "Registry": the recipe's steps as capabilities — the model each
 * runs on, and how each did over 30 days of production debriefs. Read-only:
 * models change in the Models panel above, the order is the recipe's.
 */
export const StepsPanel: React.FC = () => {
  const s = en.debriefs.run;
  const steps = useGetDebriefStepsQuery();
  return (
    <section className="flex flex-col gap-2" data-testid="steps-panel">
      <h3 className="text-xl font-normal text-typography-900">{s.registry}</h3>
      <p className="max-w-3xl text-sm text-typography-700">{s.registryHelp}</p>
      {steps.isError ? (
        <ErrorPanel
          what={s.registryLoadFailed}
          error={steps.error}
          onRetry={() => void steps.refetch()}
        />
      ) : !steps.data ? (
        <LoadingBlock lines={4} />
      ) : (
        <ConsoleTable
          testId="steps-table"
          headers={[
            s.registryColumns.step,
            s.registryColumns.model,
            s.registryColumns.recipes,
            s.registryColumns.ran,
            s.registryColumns.failed,
            s.registryColumns.skipped,
            s.registryColumns.time,
            s.registryColumns.spend,
          ]}
          rows={steps.data.map(st => ({
            key: st.step,
            testId: "step-row",
            cells: [
              <span key="s">{s.stepNames[st.step] ?? st.step}</span>,
              <span key="m" className="font-mono text-xs">
                {st.model ?? "—"}
                {st.backupModel ? ` (${st.backupModel})` : ""}
              </span>,
              <span key="r">{st.inRecipes.join(", ")}</span>,
              <span key="d">{st.done}</span>,
              <span key="f">{st.failed}</span>,
              <span key="k">{st.skipped}</span>,
              <span key="t">{st.medianMs != null ? formatMs(st.medianMs) : "—"}</span>,
              <span key="u">{formatUsd(st.estimatedUsd)}</span>,
            ],
          }))}
        />
      )}
    </section>
  );
};
