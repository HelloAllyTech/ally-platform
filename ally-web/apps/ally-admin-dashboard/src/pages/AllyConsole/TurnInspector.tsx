import React, { useEffect, useMemo, useState } from "react";

import { InlineNotification, SidePanel } from "@ally-ui-mono/ui-shared";
import { useGetAllyGuideReleasesQuery, useGetAllyGuideThreadTracesQuery } from "@api";
import { formatUsd, releaseVersionLabel, shortId } from "@components/ally-guide/allyGuideFormat";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { Pill } from "@components/ally-guide/Pill";
import { en } from "@constants";
import { useAllyGuideAccess } from "@hooks";
import { AllyGuideThreadRow } from "@types";

import { EffectiveConfigPanel } from "./EffectiveConfigPanel";
import { TranscriptPane } from "./TranscriptPane";
import { TurnCard } from "./TurnCard";

/** The server lists at most this many turns for a conversation (`AgentTraceService.listByThread`). */
const TRACE_LIMIT = 50;

interface TurnInspectorProps {
  /** The conversation to inspect; null keeps the drawer closed. */
  threadId: string | null;
  /** The list row, when the drawer was opened from the list (a deep link has only the id). */
  thread?: AllyGuideThreadRow;
  onClose: () => void;
}

const InspectorBody: React.FC<Required<Pick<TurnInspectorProps, "threadId">>> = ({ threadId }) => {
  const strings = en.allyConsole.inspector;
  const { canReadTranscripts } = useAllyGuideAccess();

  const traces = useGetAllyGuideThreadTracesQuery(threadId);
  const releases = useGetAllyGuideReleasesQuery();

  // The API lists newest first; a conversation reads top to bottom, and sits beside a transcript that does.
  const ordered = useMemo(
    () =>
      [...(traces.data ?? [])].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [traces.data],
  );

  const releaseLabels = useMemo(
    () =>
      Object.fromEntries(
        (releases.data ?? []).map(release => [release.id, releaseVersionLabel(release.version)]),
      ),
    [releases.data],
  );

  // The latest turn opens first: it is the one anyone arriving here is almost always asking about.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [chosenTurnId, setChosenTurnId] = useState<string | null>(null);
  const latestId = ordered.length ? ordered[ordered.length - 1].turnId : null;
  useEffect(() => {
    if (latestId) setExpanded(current => (current.size === 0 ? new Set([latestId]) : current));
  }, [latestId]);

  const toggle = (turnId: string) =>
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(turnId)) next.delete(turnId);
      else next.add(turnId);
      return next;
    });

  const openFromTranscript = (turnId: string) => {
    setChosenTurnId(turnId);
    setExpanded(current => new Set(current).add(turnId));
    // After the card has opened, bring it into view.
    window.setTimeout(
      () => document.getElementById(`turn-${turnId}`)?.scrollIntoView?.({ block: "nearest" }),
      0,
    );
  };

  const turnsColumn = (
    <section aria-labelledby="ally-turns-heading" data-testid="turns-column">
      <h3 id="ally-turns-heading" className="mb-3 text-xl font-normal text-typography-900">
        {strings.turnsHeading}
      </h3>
      {traces.isLoading ? (
        <LoadingBlock lines={5} />
      ) : traces.isError ? (
        <ErrorPanel what="the turns" error={traces.error} onRetry={() => void traces.refetch()} />
      ) : ordered.length === 0 ? (
        <EmptyPanel title={strings.noTurnsTitle} message={strings.noTurns} />
      ) : (
        <>
          {ordered.length >= TRACE_LIMIT && (
            <p className="mb-2 text-xs text-typography-700">{strings.latestOnly(TRACE_LIMIT)}</p>
          )}
          <ol className="flex flex-col gap-2">
            {ordered.map(trace => (
              <TurnCard
                key={trace.turnId}
                trace={trace}
                releaseLabel={trace.releaseId ? (releaseLabels[trace.releaseId] ?? null) : null}
                expanded={expanded.has(trace.turnId)}
                highlighted={chosenTurnId === trace.turnId}
                canReadPayload={canReadTranscripts}
                onToggle={() => toggle(trace.turnId)}
              />
            ))}
          </ol>
        </>
      )}
    </section>
  );

  if (!canReadTranscripts) {
    return (
      <div className="flex flex-col gap-4">
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title={strings.transcriptsLocked.title}
          subtitle={strings.transcriptsLocked.message}
          data-testid="transcripts-locked"
        />
        <EffectiveConfigPanel threadId={threadId} />
        {turnsColumn}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <EffectiveConfigPanel threadId={threadId} />
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        {turnsColumn}
        <TranscriptPane
          threadId={threadId}
          activeTurnId={chosenTurnId}
          onSelectTurn={openFromTranscript}
        />
      </div>
    </div>
  );
};

/**
 * The Turn Inspector: a drawer over the Conversations list showing one conversation's turns (stage
 * waterfall, steer and reason, Sentinel verdict, model, tier and release, tools, cards, usage and
 * cost, epoch) and, for admins with the transcripts grant, the redacted transcript beside them and a
 * payload on request. Without that grant it says so quietly and still shows everything the summary
 * traces hold, which is content-free by construction.
 */
export const TurnInspector: React.FC<TurnInspectorProps> = ({ threadId, thread, onClose }) => {
  const strings = en.allyConsole.inspector;
  const open = threadId !== null;

  const title = (
    <div className="min-w-0">
      <h2 className="truncate text-lg font-semibold text-typography-900">
        {thread
          ? (thread.trackTitle ?? en.allyConsole.conversations.untitledCourse)
          : strings.title}
      </h2>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-normal text-typography-700">
        {thread ? (
          <>
            {thread.tenantName && <span>{thread.tenantName}</span>}
            {thread.visitor && (
              <Pill tone="neutral" title={en.allyConsole.conversations.visitorHelp}>
                {en.allyConsole.conversations.visitor}
              </Pill>
            )}
            {thread.arm === "canary" && (
              <Pill tone="info" title={en.allyConsole.conversations.canaryHelp}>
                {en.allyConsole.conversations.canary}
              </Pill>
            )}
            <Pill
              tone={
                thread.mode === "NORMAL" ? "neutral" : thread.mode === "CARE" ? "warning" : "danger"
              }
            >
              {en.allyConsole.modes[thread.mode] ?? thread.mode}
            </Pill>
            <span>{en.allyConsole.threadStatuses[thread.status] ?? thread.status}</span>
            <span>{strings.epoch(thread.epoch)}</span>
            <span>{strings.conversationFacts(thread.turns, formatUsd(thread.costUsd))}</span>
          </>
        ) : (
          threadId && <span className="font-mono">{shortId(threadId)}</span>
        )}
      </div>
    </div>
  );

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={title}
      closeLabel={strings.close}
      className="w-[min(1240px,100vw)]"
    >
      {threadId && <InspectorBody key={threadId} threadId={threadId} />}
    </SidePanel>
  );
};
