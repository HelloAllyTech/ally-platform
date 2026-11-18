import React from "react";

import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@ally-ui-mono/ui-shared";
import {
  useBuildDebriefTestSetsMutation,
  useGetDebriefOverviewQuery,
  useGetDebriefMeQuery,
} from "@api";
import { LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en, ROUTES } from "@constants";
import { DebriefOverview } from "@types";
import { getErrorMessage } from "@utils";

import { codeWords } from "../consoleLabels";
import { pmAgentPath, PmAgentView, readChangesView } from "../consoleRoutes";
import { TruncatedTitle } from "../consoleRows";
import { BackLink, Tile } from "../consoleUi";
import { useDebriefAccess } from "../debriefAccess";
import { ChangesView } from "./ChangesView";
import { ReportsView } from "./ReportsView";

const VIEWS: PmAgentView[] = ["changes", "reports", "test-sets"];

/** Changes › Test sets: the Open / Gate / Sealed counts, and adding recent sessions. */
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
 * Changes (v2, U3; the old PM agent page at the same route): what the PM agent changed, grouped
 * by where each change is, with the one PM agent conversation beside it. Reports and Test sets
 * stay as tabs. `?view=` picks the tab and `?change=` the change in focus. There is no "Run the PM
 * agent now": a person asks in the conversation ("look at this week's flags now").
 */
export const PmAgentPage: React.FC = () => {
  const c = en.debriefs.v2.changes;
  const me = useGetDebriefMeQuery();
  const access = useDebriefAccess(me.data);
  const [params, setParams] = useSearchParams();
  const read = readChangesView(params);
  const change = read.change;
  // Only the Ally team and the owner get Reports and Test sets (the clinical advisor has no changes).
  const views = access.pmAgent ? VIEWS : (["changes"] as PmAgentView[]);
  const view = views.includes(read.view) ? read.view : "changes";
  const overview = useGetDebriefOverviewQuery(undefined, { skip: view !== "test-sets" });
  return (
    <div className="font-primary" data-testid="pm-agent-page">
      <header className="flex flex-col gap-3.5 border-b border-neutral-100 px-8 pt-4">
        {/* One row at lg and up; below lg the actions take a second row, on purpose. */}
        <div
          className="flex flex-col gap-3 min-[1056px]:flex-row min-[1056px]:flex-nowrap min-[1056px]:items-center"
          data-testid="pm-header"
        >
          <div className="flex min-w-0 flex-nowrap items-center gap-3">
            <div className="shrink-0">
              <BackLink to={ROUTES.DEBRIEFS}>{en.debriefs.title}</BackLink>
            </div>
            <TruncatedTitle
              as="h1"
              text={c.title}
              className="font-secondary text-[28px] font-normal"
            />
          </div>
        </div>
        {views.length > 1 && (
          <nav aria-label={c.title} className="flex flex-nowrap gap-6 whitespace-nowrap text-sm">
            {views.map(v => (
              <Link
                key={v}
                to={pmAgentPath(v)}
                aria-current={v === view ? "page" : undefined}
                className={`py-2.5 no-underline ${v === view ? "border-b-2 border-primary-500 font-semibold text-typography-900" : "text-neutral-600"}`}
              >
                {c.tabs[v]}
              </Link>
            ))}
          </nav>
        )}
      </header>

      {view === "test-sets" ? (
        <TestSetsView overview={overview} canAct={access.testSets} />
      ) : view === "reports" ? (
        <ReportsView />
      ) : (
        <ChangesView
          access={access}
          selected={change}
          onSelect={id => {
            const next = new URLSearchParams(params);
            next.delete("idea");
            next.set("change", id);
            setParams(next, { replace: true });
          }}
        />
      )}
    </div>
  );
};

export default PmAgentPage;
