import React from "react";

import { useGetDebriefModelsQuery, useGetDebriefStepsQuery } from "@api";
import { formatUsd } from "@components/ally-guide/allyGuideFormat";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en } from "@constants";

import { modelLabels, recipeLabel, stepName } from "./consoleLabels";
import { ConsoleTable } from "./consoleTable";

/**
 * v9 FR-38 "Registry": the recipe's steps as capabilities — the model each runs on and the
 * recipes it is in. Read-only: models change in the Models panel above, the order is the
 * recipe's. How often each step ran, failed and how long it took are charts under
 * Analytics → Debriefs; that view carries no spend or skips per step, so those two stay here.
 */
export const StepsPanel: React.FC = () => {
  const s = en.debriefs.run;
  const steps = useGetDebriefStepsQuery();
  const models = useGetDebriefModelsQuery();
  const label = modelLabels(models.data);
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
      ) : steps.data.length === 0 ? (
        <EmptyPanel title={s.registry} message={s.registryEmpty} />
      ) : (
        <ConsoleTable
          testId="steps-table"
          headers={[
            s.registryColumns.step,
            s.registryColumns.model,
            s.registryColumns.recipes,
            s.registryColumns.skipped,
            s.registryColumns.spend,
          ]}
          rows={steps.data.map(st => ({
            key: st.step,
            testId: "step-row",
            cells: [
              <span key="s">{stepName(st.step)}</span>,
              <span key="m" className="text-xs">
                {st.model ? <span title={st.model}>{label(st.model)}</span> : "—"}
                {st.backupModel && (
                  <>
                    {" ("}
                    <span title={st.backupModel}>{label(st.backupModel)}</span>
                    {")"}
                  </>
                )}
              </span>,
              <span key="r">{st.inRecipes.map(recipeLabel).join(", ") || "—"}</span>,
              <span key="k">{st.skipped}</span>,
              <span key="u">{formatUsd(st.estimatedUsd)}</span>,
            ],
          }))}
        />
      )}
    </section>
  );
};
