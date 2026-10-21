import React, { useEffect, useMemo, useState } from "react";

import { Add, Download, Upload } from "@icons";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button, InlineNotification, SkeletonText, Tabs } from "@ally-ui-mono/ui-shared";
import {
  useGetBuilderEvalFixturesQuery,
  useGetBuilderEvalSuitesQuery,
  useLazyExportBuilderEvalFixturesQuery,
  useUpdateBuilderEvalFixtureMutation,
} from "@api";
import { en, ROUTES } from "@constants";
import type { BuilderEvalFixture } from "@types";
import { getErrorMessage } from "@utils/errorMessage";

import { FromSessionDialog, PasteExportDialog } from "./eval/AddFixtureDialogs";
import {
  anySuiteRunning,
  averageCostPerRun,
  downloadJsonFile,
  EVAL_POLL_MS,
  fixtureRows,
  SUITE_LIST_LIMIT,
  suiteRows,
} from "./eval/evalFormat";
import { FixtureSidePanel } from "./eval/FixtureSidePanel";
import { FixturesTable } from "./eval/FixturesTable";
import { RunSuiteDialog } from "./eval/RunSuiteDialog";
import { SuiteDetailPanel } from "./eval/SuiteDetailPanel";
import { SuitesTable } from "./eval/SuitesTable";

type EvalTab = "suites" | "fixtures";

/**
 * Builder's replay eval: the recorded interviews it is judged on (fixtures), the
 * suites that play them, and what each suite found.
 *
 * Also where a proposed Builder prompt change is decided. Edits to Builder's
 * interviewer prompts are submitted from the prompt editor and appear here as a
 * "Prompt gate" suite; they go live only if that suite passes.
 */
export const BuilderEval: React.FC = () => {
  const strings = en.builder.eval;
  const navigate = useNavigate();

  const [tab, setTab] = useState<EvalTab>("suites");
  const [openFixtureId, setOpenFixtureId] = useState<string | null>(null);
  const [openSuiteId, setOpenSuiteId] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [fromSessionOpen, setFromSessionOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pendingFixtureId, setPendingFixtureId] = useState<string | null>(null);

  // The list refreshes on a timer only while a suite is running, so an idle page is a quiet one.
  const [pollMs, setPollMs] = useState(0);

  const {
    data: fixtures,
    isLoading: isLoadingFixtures,
    isError: isFixturesError,
    refetch: refetchFixtures,
  } = useGetBuilderEvalFixturesQuery();
  const {
    data: suites,
    isLoading: isLoadingSuites,
    isError: isSuitesError,
    refetch: refetchSuites,
  } = useGetBuilderEvalSuitesQuery({ limit: SUITE_LIST_LIMIT }, { pollingInterval: pollMs });
  const [updateFixture] = useUpdateBuilderEvalFixtureMutation();
  const [exportFixtures, { isFetching: isExporting }] = useLazyExportBuilderEvalFixturesQuery();

  const running = anySuiteRunning(suites);
  useEffect(() => {
    setPollMs(running ? EVAL_POLL_MS : 0);
  }, [running]);

  const fixtureList = useMemo(() => (Array.isArray(fixtures) ? fixtures : []), [fixtures]);
  const fixtureTableRows = useMemo(() => fixtureRows(fixtureList), [fixtureList]);
  const suiteTableRows = useMemo(() => suiteRows(suites), [suites]);
  const averageCost = useMemo(() => averageCostPerRun(suites), [suites]);

  const openFixture: BuilderEvalFixture | null =
    fixtureList.find(fixture => fixture.id === openFixtureId) ?? null;

  const handleToggleActive = async (id: string, active: boolean) => {
    setPendingFixtureId(id);
    try {
      await updateFixture({ id, active }).unwrap();
    } catch (error) {
      toast.error(getErrorMessage(error, strings.fixtures.toggleFailed));
    } finally {
      setPendingFixtureId(null);
    }
  };

  const handleExport = async () => {
    try {
      const result = await exportFixtures().unwrap();
      downloadJsonFile(strings.fixtures.exportFilename(new Date()), result);
    } catch (error) {
      toast.error(getErrorMessage(error, strings.fixtures.exportFailed));
    }
  };

  const handleCreated = (fixture: BuilderEvalFixture) => {
    setTab("fixtures");
    setOpenFixtureId(fixture.id);
  };

  const tabItems = [
    { id: "suites", label: strings.tabSuites, count: suiteTableRows.length },
    { id: "fixtures", label: strings.tabFixtures, count: fixtureTableRows.length },
  ];

  return (
    // `[&>*]:shrink-0`: the page is a height-bound flex column, and a long fixtures table would
    // otherwise squeeze the tab strip (which scrolls sideways, so it can shrink to nothing) and the
    // notice above it, instead of letting the page scroll.
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 overflow-y-auto md:p-6 [&>*]:shrink-0">
      <header>
        <Button kind="ghost" size="sm" onClick={() => navigate(ROUTES.BUILDER)}>
          ← {strings.backToBuilder}
        </Button>
        <h1 className="mt-2 text-xl font-semibold text-typography-900">{strings.title}</h1>
        <p className="mt-1 text-sm text-typography-600">{strings.subtitle}</p>
      </header>

      <InlineNotification
        kind="info"
        lowContrast
        hideCloseButton
        title={strings.privacy.title}
        subtitle={strings.privacy.body}
      />

      <Tabs
        items={tabItems}
        activeId={tab}
        onChange={id => setTab(id as EvalTab)}
        // A count of "0" while the lists are still loading would read as "empty".
        showCount={!isLoadingSuites && !isLoadingFixtures}
      />

      {tab === "suites" ? (
        <section className="flex flex-col gap-3" aria-label={strings.tabSuites}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-typography-600">
              {running ? strings.suites.polling(EVAL_POLL_MS / 1000) : strings.suites.caption}
            </p>
            <Button
              kind="primary"
              size="md"
              disabled={fixtureList.length === 0}
              onClick={() => setRunOpen(true)}
            >
              {strings.suites.runSuite}
            </Button>
          </div>

          {isSuitesError && (
            <div className="flex flex-col items-start gap-2">
              <InlineNotification
                kind="error"
                lowContrast
                hideCloseButton
                title={strings.suites.loadFailed}
              />
              <Button kind="tertiary" size="sm" onClick={() => void refetchSuites()}>
                {strings.retry}
              </Button>
            </div>
          )}

          {isLoadingSuites ? (
            <SkeletonText paragraph lineCount={6} />
          ) : suiteTableRows.length === 0 ? (
            !isSuitesError && (
              <div className="mt-6 text-center">
                <p className="text-sm font-medium text-typography-800">
                  {strings.suites.emptyTitle}
                </p>
                <p className="mt-1 text-sm text-typography-500">
                  {fixtureList.length === 0
                    ? strings.suites.emptyNoFixtures
                    : strings.suites.emptyBody}
                </p>
              </div>
            )
          ) : (
            <SuitesTable rows={suiteTableRows} onOpen={setOpenSuiteId} />
          )}
        </section>
      ) : (
        <section className="flex flex-col gap-3" aria-label={strings.tabFixtures}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-typography-600">{strings.fixtures.caption}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                kind="tertiary"
                size="md"
                renderIcon={Add}
                onClick={() => setFromSessionOpen(true)}
              >
                {strings.fixtures.fromSession}
              </Button>
              <Button
                kind="tertiary"
                size="md"
                renderIcon={Upload}
                onClick={() => setPasteOpen(true)}
              >
                {strings.fixtures.paste}
              </Button>
              <Button
                kind="tertiary"
                size="md"
                renderIcon={Download}
                disabled={isExporting || fixtureList.length === 0}
                onClick={() => void handleExport()}
              >
                {strings.fixtures.export}
              </Button>
            </div>
          </div>

          {isFixturesError && (
            <div className="flex flex-col items-start gap-2">
              <InlineNotification
                kind="error"
                lowContrast
                hideCloseButton
                title={strings.fixtures.loadFailed}
              />
              <Button kind="tertiary" size="sm" onClick={() => void refetchFixtures()}>
                {strings.retry}
              </Button>
            </div>
          )}

          {isLoadingFixtures ? (
            <SkeletonText paragraph lineCount={6} />
          ) : fixtureTableRows.length === 0 ? (
            !isFixturesError && (
              <div className="mt-6 text-center">
                <p className="text-sm font-medium text-typography-800">
                  {strings.fixtures.emptyTitle}
                </p>
                <p className="mt-1 text-sm text-typography-500">{strings.fixtures.emptyBody}</p>
              </div>
            )
          ) : (
            <FixturesTable
              rows={fixtureTableRows}
              onOpen={setOpenFixtureId}
              onToggleActive={(id, active) => void handleToggleActive(id, active)}
              pendingId={pendingFixtureId}
            />
          )}
        </section>
      )}

      <FixtureSidePanel fixture={openFixture} onClose={() => setOpenFixtureId(null)} />
      <SuiteDetailPanel
        suiteId={openSuiteId}
        fixtures={fixtureList}
        onClose={() => setOpenSuiteId(null)}
        onOpenSuite={setOpenSuiteId}
      />

      {runOpen && (
        <RunSuiteDialog
          fixtures={fixtureList}
          averageCostPerRun={averageCost}
          onClose={() => setRunOpen(false)}
          onStarted={() => setTab("suites")}
        />
      )}
      {fromSessionOpen && (
        <FromSessionDialog onClose={() => setFromSessionOpen(false)} onCreated={handleCreated} />
      )}
      {pasteOpen && (
        <PasteExportDialog onClose={() => setPasteOpen(false)} onCreated={handleCreated} />
      )}
    </div>
  );
};
