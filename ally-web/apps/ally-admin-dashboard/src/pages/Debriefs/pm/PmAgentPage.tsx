import React, { useMemo, useState } from "react";

import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@ally-ui-mono/ui-shared";
import {
  useBuildDebriefTestSetsMutation,
  useGetDebriefAttentionQuery,
  useGetDebriefOverviewQuery,
  useGetPmAgentStateQuery,
  useRunPmAgentMutation,
} from "@api";
import { ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en, ROUTES } from "@constants";
import { DebriefOverview } from "@types";
import { getErrorMessage } from "@utils";

import { codeWords } from "../consoleLabels";
import { pmAgentPath, PmAgentView } from "../consoleRoutes";
import { AlertBanner, BackLink, Tile } from "../consoleUi";
import { useDebriefAccess } from "../debriefAccess";
import { IdeasView } from "./IdeasView";
import { ProposeChange } from "./ProposeChange";
import { ReleasesView } from "./ReleasesView";
import { bannerText } from "../home/DebriefsHome";

const VIEWS: PmAgentView[] = ["ideas", "releases", "test-sets"];

/** PM agent › Test sets: the Open / Gate / Sealed counts, and adding recent sessions. */
const TestSetsView: React.FC<{
  overview: ReturnType<typeof useGetDebriefOverviewQuery>;
  canAct: boolean;
}> = ({ overview, canAct }) => {
  const s = en.debriefs.pmAgent;
  const [build, { isLoading }] = useBuildDebriefTestSetsMutation();
  const o: DebriefOverview | undefined = overview.data;
  const add = async () => {
    try {
      await build().unwrap();
      toast.success(s.buildSetsDone);
    } catch (e) {
      toast.error(getErrorMessage(e, s.buildSetsFailed));
    }
  };
  return (
    <div className="flex max-w-[960px] flex-col gap-4 px-8 py-7" data-testid="test-sets-view">
      <p className="max-w-3xl text-sm text-neutral-700">{s.testSetsHelp}</p>
      {overview.isError ? (
        <span className="text-sm text-neutral-700" data-testid="test-sets-error">
          {s.testSetsFailed}{" "}
          <button
            type="button"
            className="text-primary-600 underline"
            onClick={() => void overview.refetch()}
          >
            {s.retry}
          </button>
        </span>
      ) : !o ? (
        <div data-testid="test-sets-loading">
          <LoadingBlock lines={2} />
        </div>
      ) : (
        <div
          className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3"
          data-testid="test-sets"
        >
          {Object.entries(o.testSets).map(([k, n]) => (
            <Tile key={k} className="flex flex-col gap-1.5 px-5 py-4">
              <span className="text-sm font-semibold">{s.sets[k] ?? codeWords(k)}</span>
              <span className="text-[26px] font-semibold">{n}</span>
              <span className="text-[13px] text-neutral-600">
                {en.debriefs.pmPage.setHelp[k] ?? ""}
              </span>
            </Tile>
          ))}
        </div>
      )}
      {canAct && (
        <div>
          <Button kind="tertiary" size="md" disabled={isLoading} onClick={() => void add()}>
            {s.buildSets}
          </Button>
        </div>
      )}
    </div>
  );
};

/**
 * The PM agent (redesign 2026-11-12), opened from the Debriefs home: its ideas with the decisions
 * they wait on, the releases with their steps and models, and the test sets. `?view=` picks the
 * tab and `?idea=` the idea in focus, so a link opens exactly there.
 */
export const PmAgentPage: React.FC = () => {
  const s = en.debriefs.pmAgent;
  const p = en.debriefs.pmPage;
  // Open and closed ideas come as two lists (CONSOLE_API.md); one list for the page.
  const open = useGetPmAgentStateQuery({ state: "open" });
  const closed = useGetPmAgentStateQuery({ state: "closed" });
  const access = useDebriefAccess(open.data?.viewer);
  const [proposing, setProposing] = useState(false);
  const attention = useGetDebriefAttentionQuery();
  const waitingBanner = attention.data?.banners.find(b => b.kind === "release_waiting");
  const [params, setParams] = useSearchParams();
  const raw = params.get("view") as PmAgentView | null;
  const view: PmAgentView = raw && VIEWS.includes(raw) ? raw : "ideas";
  const state = useMemo(() => {
    if (!open.data) return { ...open, data: undefined };
    const seen = new Set(open.data.ideas.map(i => i.id));
    const ideas = [...open.data.ideas, ...(closed.data?.ideas ?? []).filter(i => !seen.has(i.id))];
    return { ...open, data: { ...open.data, ideas } };
  }, [open, closed.data]);
  const onTheWay =
    open.data?.counts?.open ?? open.data?.ideas.filter(i => i.state !== "closed").length ?? 0;
  const overview = useGetDebriefOverviewQuery();
  const [run, { isLoading: running }] = useRunPmAgentMutation();

  const runNow = async () => {
    try {
      const res = await run().unwrap();
      if (res.skipped) toast.success(s.skipped(res.skipped));
      else toast.success(s.ran);
    } catch (e) {
      toast.error(getErrorMessage(e, s.runFailed));
    }
  };

  return (
    <div className="font-primary" data-testid="pm-agent-page">
      <header className="flex flex-col gap-3.5 border-b border-neutral-100 px-8 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <BackLink to={ROUTES.DEBRIEFS}>{en.debriefs.title}</BackLink>
          <h1 className="font-secondary text-[28px] font-normal">{p.title}</h1>
          <div className="flex-1" />
          {access.pmAgent && (
            <Button kind="tertiary" size="md" onClick={() => setProposing(true)}>
              {p.propose.button}
            </Button>
          )}
          {access.pmAgent && (
            <Button kind="tertiary" size="md" disabled={running} onClick={() => void runNow()}>
              {running ? s.running : s.runNow}
            </Button>
          )}
        </div>
        <nav aria-label={p.title} className="flex gap-6 text-sm">
          {VIEWS.map(v => (
            <Link
              key={v}
              to={pmAgentPath(v)}
              aria-current={v === view ? "page" : undefined}
              className={`py-2.5 no-underline ${v === view ? "border-b-2 border-primary-500 font-semibold text-typography-900" : "text-neutral-600"}`}
            >
              {p.tabs[v]}
            </Link>
          ))}
        </nav>
      </header>

      {waitingBanner && view !== "releases" && (
        <div className="px-8 pt-4">
          <AlertBanner
            kind={waitingBanner.level === "red" ? "error" : "warning"}
            testId="pm-release-waiting-banner"
            action={
              <Link to={pmAgentPath("releases")} className="text-sm font-semibold">
                {en.debriefs.home.bannerActions.releases}
              </Link>
            }
          >
            {bannerText(waitingBanner)}
          </AlertBanner>
        </div>
      )}
      {proposing && (
        <ProposeChange
          canChangeBudgets={access.settings}
          onCancel={() => setProposing(false)}
          onDone={ideaId => {
            setProposing(false);
            setParams({ idea: ideaId });
          }}
        />
      )}
      {view === "test-sets" ? (
        <TestSetsView overview={overview} canAct={access.testSets} />
      ) : state.isError ? (
        <div className="px-8 py-6">
          <ErrorPanel
            what={s.loadFailed}
            error={state.error}
            onRetry={() => void state.refetch()}
          />
        </div>
      ) : !state.data ? (
        <div className="px-8 py-6">
          <LoadingBlock lines={8} />
        </div>
      ) : view === "releases" ? (
        <ReleasesView
          canAct={access.releases}
          onTheWay={onTheWay}
          selected={params.get("releaseId")}
          onSelect={id => {
            const next = new URLSearchParams(params);
            next.set("releaseId", id);
            setParams(next, { replace: true });
          }}
        />
      ) : (
        <IdeasView
          state={state.data}
          overview={overview.data}
          access={access}
          focusId={params.get("idea")}
          onFocus={id => {
            const next = new URLSearchParams(params);
            next.set("idea", id);
            setParams(next, { replace: true });
          }}
          onOpenRelease={releaseId => setParams({ view: "releases", releaseId })}
        />
      )}
    </div>
  );
};

export default PmAgentPage;
