import React, { useState } from "react";

import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@ally-ui-mono/ui-shared";
import {
  useGetDebriefPinnedRulesQuery,
  useGetDebriefReleasesQuery,
  useRollbackDebriefReleaseMutation,
} from "@api";
import { formatUsd, releaseVersionLabel } from "@components/ally-guide/allyGuideFormat";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en } from "@constants";
import { DebriefOverview, DebriefReleaseRow, PmAgentIdeaRow } from "@types";
import { getErrorMessage } from "@utils";

import { codeWords, inWords, promptName, releaseStatusLabel } from "../consoleLabels";
import { pmAgentPath, settingsPath } from "../consoleRoutes";
import { score } from "../consoleTable";
import { ConsoleTag } from "../consoleUi";
import { EvidenceBlock, EvidenceStat } from "./EvidenceBlock";
import { ideaCode } from "./IdeaCard";
import { StepsAndModels } from "./StepsAndModels";

/** The prompts only the clinical advisor or the owner may change (pinned rules). */
export const PINNED_PROMPTS = new Set([
  "debrief_safety_reader_system",
  "debrief_quality_rubric",
  "debrief_quality_judge_system",
]);

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—";

/** A release that has been live: the live one, and those retired or rolled back after. */
export const hasBeenLive = (r: DebriefReleaseRow) =>
  r.status === "ga" || !!r.promotedAt || r.status === "rolled_back";

const titleOf = (r: DebriefReleaseRow, idea?: PmAgentIdeaRow) =>
  r.title ?? (idea ? inWords(idea.title) : null) ?? r.notes ?? en.debriefs.pmPage.releases.untitled;

/** The prompts whose version differs from the release before (real data from both rows). */
export const promptChanges = (r: DebriefReleaseRow, prev: DebriefReleaseRow | undefined) =>
  Object.entries(r.prompts)
    .filter(([code, v]) => prev && prev.prompts[code] !== v)
    .map(([code, v]) => ({ code, from: prev?.prompts[code] ?? null, to: v }));

const delta = (
  now: number | null,
  before: number | null | undefined,
  unit: (x: number) => string,
) => (now == null || before == null ? undefined : now - before === 0 ? null : unit(now - before));

/**
 * PM agent › Releases (redesign 2026-11-12): only the releases learners have had, newest first,
 * on the left; the one picked on the right with what changed, whether it worked, and everything
 * in it. Nothing live is edited here: every change becomes a new release from an idea or a
 * setting, and rolling back restores all of it.
 */
export const ReleasesView: React.FC<{
  canAct: boolean;
  ideas: PmAgentIdeaRow[];
  overview: DebriefOverview | undefined;
  selected: number | null;
  onSelect: (version: number) => void;
}> = ({ canAct, ideas, overview, selected, onSelect }) => {
  const s = en.debriefs.releases;
  const p = en.debriefs.pmPage.releases;
  const releases = useGetDebriefReleasesQuery();
  const pinned = useGetDebriefPinnedRulesQuery();
  const [rollback, { isLoading }] = useRollbackDebriefReleaseMutation();
  const [confirming, setConfirming] = useState(false);

  if (releases.isError) {
    return (
      <div className="px-8 py-6">
        <ErrorPanel
          what={s.loadFailed}
          error={releases.error}
          onRetry={() => void releases.refetch()}
        />
      </div>
    );
  }
  if (!releases.data) {
    return (
      <div className="px-8 py-6">
        <LoadingBlock lines={6} />
      </div>
    );
  }
  const list = releases.data.filter(hasBeenLive).sort((a, b) => b.version - a.version);
  const onTheWay = ideas.filter(
    i => i.status === "proposed" && !i.expired && i.evidence.canary?.status !== "reverted",
  ).length;
  const sel =
    list.find(r => r.version === selected) ?? list.find(r => r.status === "ga") ?? list[0];
  const prev = sel ? list.find(r => r.version < sel.version) : undefined;
  const idea = sel ? ideas.find(i => i.releaseVersion === sel.version) : undefined;
  const isLive = sel?.status === "ga";

  const doRollback = async () => {
    if (!sel) return;
    try {
      await rollback({ id: sel.id }).unwrap();
      toast.success(s.rolledBack);
      setConfirming(false);
    } catch (e) {
      toast.error(getErrorMessage(e, s.rollbackFailed));
    }
  };

  const stats: EvidenceStat[] = [];
  const live = sel?.live;
  if (live) {
    const vs = live.previous;
    const was = (x: string) => (vs ? p.vs(x, vs.version) : undefined);
    stats.push({ label: p.stats.debriefs, value: String(live.debriefs) });
    stats.push({
      label: p.stats.judge,
      value: score(live.judgeMedian),
      sub: vs ? was(score(vs.judgeMedian)) : undefined,
    });
    stats.push({
      label: p.stats.hardFails,
      value: live.hardFails == null ? "—" : String(live.hardFails),
      sub: vs ? was(vs.hardFails == null ? "—" : String(vs.hardFails)) : undefined,
      good:
        vs && live.hardFails != null && vs.hardFails != null
          ? live.hardFails <= vs.hardFails
          : undefined,
    });
    const costDelta = delta(
      live.costUsd,
      vs?.costUsd,
      d => `${d > 0 ? "+" : "−"}${formatUsd(Math.abs(d))}`,
    );
    stats.push({
      label: p.stats.cost,
      value: formatUsd(live.costUsd),
      sub: costDelta === undefined ? undefined : costDelta === null ? p.same : costDelta,
      good: costDelta === undefined ? undefined : (live.costUsd ?? 0) <= (vs?.costUsd ?? 0),
    });
    stats.push({
      label: p.stats.time,
      value: live.seconds == null ? "—" : `${live.seconds} s`,
    });
  } else if (isLive && overview) {
    stats.push({ label: p.stats.debriefs, value: String(overview.judge.scored) });
    stats.push({ label: p.stats.judgeMean, value: score(overview.judge.mean) });
    stats.push({ label: p.stats.cost, value: formatUsd(overview.costUsd.p50) });
    stats.push({
      label: p.stats.time,
      value: overview.seconds.p50 == null ? "—" : `${overview.seconds.p50} s`,
    });
  }
  const changes = sel ? promptChanges(sel, prev) : [];

  return (
    <div className="flex flex-col gap-4 px-8 py-6" data-testid="releases-view">
      <div className="flex flex-wrap items-baseline gap-3">
        <p className="max-w-3xl text-sm text-neutral-700">{p.explainer}</p>
        {onTheWay > 0 && (
          <Link to={pmAgentPath("ideas")} className="ml-auto text-sm" data-testid="on-their-way">
            {p.onTheWay(onTheWay)}
          </Link>
        )}
      </div>
      {!sel ? (
        <EmptyPanel title={s.heading} message={s.empty} />
      ) : (
        <div className="flex flex-wrap items-start gap-6">
          <nav
            aria-label={p.listLabel}
            className="flex max-w-[300px] flex-[1_1_260px] flex-col gap-1.5"
          >
            {list.map(r => {
              const on = r.id === sel.id;
              const ri = ideas.find(i => i.releaseVersion === r.version);
              return (
                <button
                  key={r.id}
                  type="button"
                  aria-current={on ? "true" : undefined}
                  data-testid="release-row"
                  onClick={() => {
                    setConfirming(false);
                    onSelect(r.version);
                  }}
                  className={`flex flex-col gap-1 rounded-sm border-l-[3px] px-3 py-2.5 text-left ${on ? "border-primary-500 bg-neutral-50" : "border-transparent"}`}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{releaseVersionLabel(r.version)}</span>
                    <ConsoleTag tone={r.status === "ga" ? "success" : "neutral"}>
                      {r.status === "ga"
                        ? s.live
                        : r.rolledBack
                          ? p.rolledBack
                          : releaseStatusLabel(r.status)}
                    </ConsoleTag>
                  </span>
                  <span className="text-sm">{titleOf(r, ri)}</span>
                  <span className="text-xs text-neutral-600">
                    {s.authors[r.authorKind] ?? codeWords(r.authorKind)} ·{" "}
                    {day(r.promotedAt ?? r.createdAt)}
                  </span>
                </button>
              );
            })}
          </nav>

          <main
            className="flex min-w-0 max-w-[860px] flex-[999_1_560px] flex-col gap-5"
            data-testid="release-detail"
          >
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-[22px] font-semibold">
                {releaseVersionLabel(sel.version)} · {titleOf(sel, idea)}
              </h2>
              <ConsoleTag tone={isLive ? "success" : "neutral"}>
                {isLive ? s.live : sel.rolledBack ? p.rolledBack : releaseStatusLabel(sel.status)}
              </ConsoleTag>
              <span className="text-[13px] text-neutral-600">
                {s.authors[sel.authorKind] ?? codeWords(sel.authorKind)} ·{" "}
                {isLive
                  ? p.since(day(sel.promotedAt ?? sel.createdAt))
                  : day(sel.promotedAt ?? sel.createdAt)}
              </span>
              <div className="flex-1" />
              {canAct && !isLive && (
                <Button kind="tertiary" size="sm" onClick={() => setConfirming(true)}>
                  {p.rollBack}
                </Button>
              )}
            </div>
            <div className="text-[13px] text-neutral-600" data-testid="release-source">
              {sel.source ??
                (idea ? p.fromIdea(ideaCode(idea)) : (s.authors[sel.authorKind] ?? ""))}
              {!isLive && sel.retiredReason ? ` · ${p.retired(sel.retiredReason)}` : ""}
            </div>
            {confirming && (
              <div
                role="alertdialog"
                aria-label={p.confirmLabel}
                className="flex flex-wrap items-center gap-3 border-l-[3px] border-[#FF832B] bg-[#FFF2E8] px-4 py-3 text-sm"
                data-testid="rollback-confirm"
              >
                <div className="min-w-[16rem] flex-1">
                  <b>{p.confirmTitle(releaseVersionLabel(sel.version))}</b> {p.confirmBody}
                </div>
                <Button
                  kind="primary"
                  size="sm"
                  disabled={isLoading}
                  onClick={() => void doRollback()}
                >
                  {s.rollbackConfirm}
                </Button>
                <Button kind="ghost" size="sm" onClick={() => setConfirming(false)}>
                  {en.debriefs.pmAgent.cancel}
                </Button>
              </div>
            )}

            <section className="flex flex-col gap-3" data-testid="release-changes">
              <h3 className="text-[15px] font-semibold">
                {prev ? p.whatChanged(releaseVersionLabel(prev.version)) : p.whatChangedFirst}
              </h3>
              {sel.summary && <p className="text-sm text-neutral-700">{sel.summary}</p>}
              {(sel.changes ?? []).map((c, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-2 rounded-sm bg-neutral-50 px-4 py-3"
                  data-testid="release-change"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <ConsoleTag tone="info">{c.area}</ConsoleTag>
                    <span className="font-semibold">{c.what}</span>
                  </div>
                  {c.why && <div className="text-[13px] text-neutral-700">{p.why(c.why)}</div>}
                  {(c.before || c.after) && (
                    <div className="grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-2">
                      <div className="bg-white px-3 py-2">
                        <div className="text-xs text-neutral-600">{p.before}</div>
                        {c.before ?? "—"}
                      </div>
                      <div className="bg-white px-3 py-2">
                        <div className="text-xs text-neutral-600">{p.after}</div>
                        {c.after ?? "—"}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {!sel.changes?.length &&
                changes.map(c => (
                  <div
                    key={c.code}
                    className="flex items-center gap-2 rounded-sm bg-neutral-50 px-4 py-3 text-sm"
                    data-testid="release-change"
                  >
                    <ConsoleTag tone="info">{p.areaPrompt}</ConsoleTag>
                    {p.promptChange(promptName(c.code), c.from, c.to)}
                  </div>
                ))}
              {prev && (
                <p className="text-[13px] text-neutral-600">
                  {p.restSame(releaseVersionLabel(prev.version))}
                </p>
              )}
            </section>

            <EvidenceBlock
              title={p.didItWork}
              idea={idea ?? null}
              beforeTitle={p.beforeLive}
              afterTitle={isLive ? p.sinceLive : p.whileLive}
              stats={stats}
              testId="release-evidence"
            />

            <details
              className="rounded-sm bg-neutral-50 px-5 py-4 text-sm"
              data-testid="release-contents"
            >
              <summary className="cursor-pointer text-[15px] font-semibold">{p.everything}</summary>
              <div className="mt-3 flex flex-col gap-5">
                <div>
                  <div className="mb-2 text-sm font-semibold">{p.promptsHeading}</div>
                  <ul className="flex flex-col divide-y divide-neutral-100 rounded-sm bg-white">
                    {Object.entries(sel.prompts).map(([code, v]) => {
                      const changed = changes.some(c => c.code === code);
                      return (
                        <li
                          key={code}
                          className="grid grid-cols-[minmax(0,1fr)_60px_120px_100px] gap-3 px-3 py-2 text-[13px]"
                        >
                          <span>{promptName(code)}</span>
                          <span>{v == null ? "—" : `v${v}`}</span>
                          <span className={changed ? "text-primary-700" : "text-neutral-600"}>
                            {changed ? p.changed : p.unchanged}
                          </span>
                          <span className="text-neutral-600">
                            {PINNED_PROMPTS.has(code) ? p.pinnedLock : p.releaseOnly}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                {isLive && <StepsAndModels canEdit={false} />}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <div className="mb-2 text-sm font-semibold">{p.settingsHeading}</div>
                    <ul className="flex flex-col gap-1 text-[13px]">
                      {sel.maxRevisionRounds != null && (
                        <li>{p.revisionRounds(sel.maxRevisionRounds)}</li>
                      )}
                      {Object.entries(sel.settings ?? {}).map(([k, v]) => (
                        <li key={k}>
                          {en.debriefs.settings.names[k] ?? codeWords(k)}: {String(v)}
                        </li>
                      ))}
                    </ul>
                    <Link to={settingsPath()} className="mt-2 inline-block text-[13px]">
                      {p.changeInSettings}
                    </Link>
                  </div>
                  <div>
                    <div className="mb-2 text-sm font-semibold">
                      {p.pinnedHeading}{" "}
                      <span className="font-normal text-neutral-600">· {p.locked}</span>
                    </div>
                    <ul className="flex flex-col gap-1 text-[13px]">
                      {(pinned.data?.rules ?? []).map(r => (
                        <li key={r.code}>
                          {r.label}: {r.version == null ? "—" : `v${r.version}`}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </details>
          </main>
        </div>
      )}
    </div>
  );
};
