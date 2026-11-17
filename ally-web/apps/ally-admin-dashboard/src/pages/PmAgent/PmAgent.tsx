import React from "react";

import { useSearchParams } from "react-router-dom";

import { Button, ContentSwitcher, Switch } from "@ally-ui-mono/ui-shared";
import { useGetPmAgentFeedStateQuery } from "@api";

import { AgentView } from "./AgentView";
import { copy } from "./copy";
import { ReviewView } from "./ReviewView";
import { TrackingView } from "./TrackingView";
import { usePmAgentControls } from "./usePmAgentControls";
import { usePmAgentSocket } from "../../hooks/usePmAgentSocket";

const STATE_POLL_MS = 30_000;
const VIEWS = ["review", "tracking", "agent"] as const;
type View = (typeof VIEWS)[number];

/**
 * PM Agent: an AI product manager that proposes a few changes a day. Review (default), Tracking
 * and Agent share one header. Live updates arrive over the `/pm-agent` socket; `GET /state` is
 * also polled every 30 s as the fallback.
 */
export const PmAgentFeed: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const requested = params.get("view");
  const view: View = (VIEWS as readonly string[]).includes(requested ?? "")
    ? (requested as View)
    : "review";
  const setView = (next: View) => {
    const p = new URLSearchParams(params);
    if (next === "review") p.delete("view");
    else p.set("view", next);
    setParams(p, { replace: true });
  };

  const { data: state, isError: stateFailed } = useGetPmAgentFeedStateQuery(undefined, {
    pollingInterval: STATE_POLL_MS,
    skipPollingIfUnfocused: true,
  });
  usePmAgentSocket();
  const controls = usePmAgentControls();

  const open = state?.queue.open ?? 0;
  const needsYou = state?.queue.needsYou ?? 0;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-typography-900">{copy.title}</h1>
          <p className="text-sm text-typography-600">{copy.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {state && (
            <span className="text-sm text-typography-700">
              {copy.today(Math.max(0, open - needsYou), needsYou)}
            </span>
          )}
          <Button
            kind="tertiary"
            size="md"
            disabled={controls.running || state?.agentState === "running"}
            onClick={controls.runNow}
          >
            {controls.running || state?.agentState === "running" ? copy.running : copy.runNow}
          </Button>
        </div>
      </header>

      <div className="max-w-md" aria-label={copy.viewSwitcher}>
        <ContentSwitcher
          size="md"
          selectedIndex={VIEWS.indexOf(view)}
          onChange={(e: { name?: string | number }) => setView(String(e.name) as View)}
        >
          {VIEWS.map(v => (
            <Switch key={v} name={v} text={copy.views[v]} />
          ))}
        </ContentSwitcher>
      </div>

      {view === "review" && (
        <ReviewView
          state={state}
          stateLoadFailed={stateFailed}
          onOpenSettings={() => setView("agent")}
        />
      )}
      {view === "tracking" && <TrackingView />}
      {view === "agent" && <AgentView />}
    </div>
  );
};
