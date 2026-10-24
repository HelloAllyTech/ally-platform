import React, { useState } from "react";

import { toast } from "sonner";

import {
  Button,
  ContentSwitcher,
  Select,
  SelectItem,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ally-ui-mono/ui-shared";
import {
  useAcceptAllyGuideEvalCaseMutation,
  useCreateAllyGuideEvalVariantsMutation,
  useGenerateAllyGuideRedTeamMutation,
  useGetAllyGuideEvalCasesQuery,
  useGetAllyGuideEvalSuitesQuery,
  useRetireAllyGuideEvalCaseMutation,
} from "@api";
import { ConfirmDialog } from "@components/ally-guide/ConfirmDialog";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { InfoTip } from "@components/ally-guide/InfoTip";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { useAllyGuideAccess } from "@hooks";
import { AllyGuideEvalCase, AllyGuideEvalCaseStatus } from "@types";
import { getErrorMessage } from "@utils";

const STATUSES = ["proposed", "active", "retired", "all"] as const;
type StatusFilter = (typeof STATUSES)[number];
const CASE_LIMIT = 200;

const humanise = (category: string) => category.replace(/_/g, " ");

/**
 * Suites and cases. A case is one conversation moment replayed against a release in dry run; a
 * proposed case (from a failed turn, a red-team run or a variant) runs nowhere until someone accepts
 * it. Titles, categories and counts only: a case's input can hold a learner's redacted words, so it
 * is not shown here. Changing a case needs the edit grant and is hidden without it.
 */
export const EvalCasesPanel: React.FC = () => {
  const strings = en.allyConsole.evals.cases;
  const { canEdit } = useAllyGuideAccess();
  const [status, setStatus] = useState<StatusFilter>("proposed");
  const [suite, setSuite] = useState("");

  const suites = useGetAllyGuideEvalSuitesQuery();
  const cases = useGetAllyGuideEvalCasesQuery({
    status: status === "all" ? undefined : (status as AllyGuideEvalCaseStatus),
    suite: suite || undefined,
    limit: CASE_LIMIT,
  });
  const [accept] = useAcceptAllyGuideEvalCaseMutation();
  const [retire] = useRetireAllyGuideEvalCaseMutation();
  const [variants] = useCreateAllyGuideEvalVariantsMutation();
  const [generate, { isLoading: isGenerating }] = useGenerateAllyGuideRedTeamMutation();

  const [workingId, setWorkingId] = useState<string | null>(null);
  const [redTeamOpen, setRedTeamOpen] = useState(false);

  const suiteName = (id: string) => suites.data?.find(item => item.id === id)?.name ?? "—";

  const act = async (
    evalCase: AllyGuideEvalCase,
    run: () => Promise<unknown>,
    success: (result: unknown) => string,
  ) => {
    setWorkingId(evalCase.id);
    try {
      toast.success(success(await run()));
    } catch (failure) {
      toast.error(getErrorMessage(failure, strings.actionFailed));
    } finally {
      setWorkingId(null);
    }
  };

  const handleGenerate = async () => {
    try {
      const report = await generate().unwrap();
      toast.success(strings.redTeamDialog.result(report.created, report.duplicates));
      if (report.stoppedBy) toast.error(strings.redTeamDialog.stopped(report.stoppedBy));
      setRedTeamOpen(false);
    } catch (failure) {
      toast.error(getErrorMessage(failure, strings.redTeamDialog.failed));
    }
  };

  return (
    <div className="flex flex-col gap-8" data-testid="ally-eval-cases">
      <section className="flex flex-col gap-3" aria-labelledby="eval-suites-heading">
        <div className="flex items-center gap-1">
          <h3 id="eval-suites-heading" className="text-xl font-normal text-typography-900">
            {strings.suitesHeading}
          </h3>
          <InfoTip label={strings.suitesHelp} ariaLabel="About suites" />
        </div>
        {suites.isLoading ? (
          <LoadingBlock lines={2} />
        ) : suites.isError || !suites.data ? (
          <ErrorPanel
            what="the suites"
            error={suites.error}
            onRetry={() => void suites.refetch()}
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="eval-suites">
            {suites.data.map(item => (
              <li key={item.id} className="border border-border-light p-3" data-testid="eval-suite">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-typography-900">{item.name}</span>
                  <Pill tone="neutral">{strings.kinds[item.kind] ?? item.kind}</Pill>
                </div>
                <p className="mt-1 text-sm text-typography-800">
                  {strings.suiteCounts(item.active, item.proposed, item.safety)}
                </p>
                {item.description && (
                  <p className="mt-1 text-xs text-typography-700">{item.description}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="eval-cases-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <h3 id="eval-cases-heading" className="text-xl font-normal text-typography-900">
              {strings.heading}
            </h3>
            <InfoTip label={strings.help} ariaLabel="About cases" />
          </div>
          {canEdit && (
            <Button kind="tertiary" size="md" onClick={() => setRedTeamOpen(true)}>
              {strings.redTeam}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <ContentSwitcher
            size="md"
            selectedIndex={STATUSES.indexOf(status)}
            onChange={(event: { name?: string | number }) => setStatus(event.name as StatusFilter)}
            className="max-w-lg"
            aria-label={strings.statusLabel}
          >
            {STATUSES.map(name => (
              <Switch key={name} name={name} text={strings.statuses[name]} />
            ))}
          </ContentSwitcher>
          <Select
            id="eval-suite-filter"
            labelText={strings.suiteFilter}
            value={suite}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setSuite(event.target.value)}
          >
            <SelectItem value="" text={strings.allSuites} />
            {(suites.data ?? []).map(item => (
              <SelectItem key={item.id} value={item.key} text={item.name} />
            ))}
          </Select>
        </div>

        {cases.isError ? (
          <ErrorPanel
            what={strings.loadFailed}
            error={cases.error}
            onRetry={() => void cases.refetch()}
          />
        ) : !cases.currentData ? (
          <LoadingBlock lines={5} />
        ) : cases.currentData.length === 0 ? (
          <EmptyPanel title={strings.emptyTitle} message={strings.emptyMessage} />
        ) : (
          <div className="overflow-x-auto">
            <Table className="w-full border-collapse text-left" data-testid="eval-cases-table">
              <TableHead>
                <TableRow className="border-b border-border-light text-sm text-typography-700">
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.columns.title}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.columns.suite}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.columns.category}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.columns.source}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    {strings.columns.status}
                  </TableHeader>
                  <TableHeader className="py-3 pr-4 font-medium">
                    <span className="sr-only">Actions</span>
                  </TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {cases.currentData.map(evalCase => (
                  <TableRow
                    key={evalCase.id}
                    className="border-b border-border-light align-top text-sm text-typography-900"
                    data-testid="eval-case-row"
                  >
                    <TableCell className="max-w-md break-words py-3 pr-4">
                      <span className="block">{evalCase.title}</span>
                      {evalCase.safety && (
                        <span className="mt-1 inline-flex items-center gap-1">
                          <Pill tone="warning">{strings.safety}</Pill>
                          <InfoTip label={strings.safetyHelp} ariaLabel="About safety cases" />
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="py-3 pr-4">{suiteName(evalCase.suiteId)}</TableCell>
                    <TableCell className="py-3 pr-4">{humanise(evalCase.category)}</TableCell>
                    <TableCell className="py-3 pr-4">
                      {strings.sources[evalCase.source] ?? evalCase.source}
                    </TableCell>
                    <TableCell className="py-3 pr-4">
                      {strings.statuses[evalCase.status] ?? evalCase.status}
                    </TableCell>
                    <TableCell className="py-3 pr-4">
                      {canEdit && evalCase.status !== "retired" && (
                        <div className="flex flex-wrap gap-2">
                          {evalCase.status === "proposed" && (
                            <Button
                              kind="primary"
                              size="sm"
                              aria-label={strings.acceptLabel(evalCase.title)}
                              disabled={workingId === evalCase.id}
                              onClick={() =>
                                void act(
                                  evalCase,
                                  () => accept(evalCase.id).unwrap(),
                                  () => strings.accepted,
                                )
                              }
                            >
                              {strings.accept}
                            </Button>
                          )}
                          {evalCase.source !== "counterfactual" && (
                            <Button
                              kind="tertiary"
                              size="sm"
                              aria-label={strings.variantsLabel(evalCase.title)}
                              disabled={workingId === evalCase.id}
                              onClick={() =>
                                void act(
                                  evalCase,
                                  () => variants(evalCase.id).unwrap(),
                                  result => {
                                    const list = (result as { duplicate: boolean }[]) ?? [];
                                    const duplicates = list.filter(item => item.duplicate).length;
                                    return strings.variantsMade(
                                      list.length - duplicates,
                                      duplicates,
                                    );
                                  },
                                )
                              }
                            >
                              {strings.variants}
                            </Button>
                          )}
                          <Button
                            kind="danger--tertiary"
                            size="sm"
                            aria-label={strings.retireLabel(evalCase.title)}
                            disabled={workingId === evalCase.id}
                            onClick={() =>
                              void act(
                                evalCase,
                                () => retire(evalCase.id).unwrap(),
                                () => strings.retired,
                              )
                            }
                          >
                            {strings.retire}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {cases.currentData && cases.currentData.length >= CASE_LIMIT && (
          <p className="text-xs text-typography-700">{strings.limitNote(CASE_LIMIT)}</p>
        )}
      </section>

      <ConfirmDialog
        isOpen={redTeamOpen}
        title={strings.redTeamDialog.title}
        cancelLabel={strings.redTeamDialog.cancel}
        confirmLabel={isGenerating ? strings.redTeamDialog.working : strings.redTeamDialog.confirm}
        isWorking={isGenerating}
        onConfirm={() => void handleGenerate()}
        onClose={() => setRedTeamOpen(false)}
      >
        <p>{strings.redTeamDialog.body}</p>
      </ConfirmDialog>
    </div>
  );
};
