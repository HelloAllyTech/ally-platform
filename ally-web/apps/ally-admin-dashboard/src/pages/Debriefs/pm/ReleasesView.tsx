import React, { useState } from "react";

import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@ally-ui-mono/ui-shared";
import {
  useGetDebriefModelsQuery,
  useGetDebriefReleaseCompareQuery,
  useGetDebriefReleaseDetailQuery,
  useGetDebriefReleaseHistoryQuery,
  useRollbackDebriefReleaseMutation,
} from "@api";
import { formatUsd, releaseVersionLabel } from "@components/ally-guide/allyGuideFormat";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en } from "@constants";
import {
  DebriefLiveMetrics,
  DebriefReleaseDetail,
  DebriefReleaseHistoryItem,
  DebriefRungState,
} from "@types";
import { getErrorMessage } from "@utils";

import { codeWords, modelLabels, promptName, recipeLabel, stepName } from "../consoleLabels";
import { pmAgentPath, settingsPath } from "../consoleRoutes";
import { score } from "../consoleTable";
import { ConsoleTag } from "../consoleUi";
import { EvidenceBlock, EvidenceStat, RungState } from "./EvidenceBlock";
import { WaitingRelease } from "./WaitingRelease";

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—";

/** Where a release came from, in words. */
export const originText = (item: DebriefReleaseHistoryItem): string => {
  const p = en.debriefs.pmPage.releases.origin;
  const c = item.cameFrom;
  switch (c.kind) {
    case "idea":
      return c.proposedBy === "person" ? p.personIdea(c.title) : p.agentIdea(c.title);
    case "code":
      return c.tag ? p.codeTag(c.tag) : p.code;
    case "settings_change":
      return p.settings(c.by?.name ?? p.someone);
    case "skills_store":
      return p.skillsStore(c.by?.name ?? p.someone, promptName(c.promptCode), c.from, c.to);
    default:
      return c.fromVersion != null ? p.rollBack(c.fromVersion) : p.rollBackPlain;
  }
};

const RUNG_STATE: Record<DebriefRungState, RungState> = {
  passed: "passed",
  failed: "not",
  running: "running",
  waiting: "waiting",
  skipped: "skipped",
  off: "skipped",
};

/** "While it was live" against the release before, over each one's own live period. */
const liveStats = (
  m: DebriefLiveMetrics,
  prev: DebriefLiveMetrics | null,
  prevVersion: number | null,
): EvidenceStat[] => {
  const p = en.debriefs.pmPage.releases;
  const was = (x: string) => (prev && prevVersion != null ? p.vs(x, prevVersion) : undefined);
  const lowerIsBetter = (a: number | null, b: number | null | undefined) =>
    a == null || b == null ? undefined : a <= b;
  return [
    { label: p.stats.debriefs, value: String(m.debriefs) },
    {
      label: p.stats.judge,
      value: score(m.judgeMedian),
      sub: prev ? was(score(prev.judgeMedian)) : undefined,
      good:
        prev && m.judgeMedian != null && prev.judgeMedian != null
          ? m.judgeMedian >= prev.judgeMedian
          : undefined,
    },
    {
      label: p.stats.hardFails,
      value: m.hardFails == null ? "—" : String(m.hardFails),
      sub: prev ? was(prev.hardFails == null ? "—" : String(prev.hardFails)) : undefined,
      good: lowerIsBetter(m.hardFails, prev?.hardFails),
    },
    {
      label: p.stats.cost,
      value: formatUsd(m.costPerDebriefUsd),
      sub: prev ? was(formatUsd(prev.costPerDebriefUsd)) : undefined,
      good: lowerIsBetter(m.costPerDebriefUsd, prev?.costPerDebriefUsd),
    },
    {
      label: p.stats.time,
      value: m.secondsToDebrief == null ? "—" : `${m.secondsToDebrief} s`,
      sub: prev
        ? was(prev.secondsToDebrief == null ? "—" : `${prev.secondsToDebrief} s`)
        : undefined,
      good: lowerIsBetter(m.secondsToDebrief, prev?.secondsToDebrief),
    },
  ];
};

/** The prompts' before and after, from `releases/:id/compare`, opened on request. */
const FullCompare: React.FC<{ id: string; against: string }> = ({ id, against }) => {
  const p = en.debriefs.pmPage.releases;
  const q = useGetDebriefReleaseCompareQuery({ id, with: against });
  if (q.isError) return <p className="text-sm text-neutral-600">{p.compareFailed}</p>;
  if (!q.data) return <LoadingBlock lines={3} />;
  const changed = q.data.prompts.filter(x => x.before?.text !== x.after?.text);
  if (!changed.length) return <p className="text-sm text-neutral-600">{p.noPromptChanges}</p>;
  return (
    <div className="flex flex-col gap-3" data-testid="release-compare">
      {changed.map(x => (
        <div key={x.code} className="flex flex-col gap-1">
          <div className="text-sm font-semibold">{promptName(x.code)}</div>
          <div className="grid grid-cols-1 gap-2 text-[13px] md:grid-cols-2">
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap bg-destructive-50 p-2">
              {x.before?.text ?? "—"}
            </pre>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap bg-success-50 p-2">
              {x.after?.text ?? "—"}
            </pre>
          </div>
        </div>
      ))}
    </div>
  );
};

const Detail: React.FC<{ id: string; canAct: boolean }> = ({ id, canAct }) => {
  const s = en.debriefs.releases;
  const p = en.debriefs.pmPage.releases;
  const q = useGetDebriefReleaseDetailQuery(id);
  const models = useGetDebriefModelsQuery();
  const label = modelLabels(models.data);
  const [rollback, { isLoading }] = useRollbackDebriefReleaseMutation();
  const [confirming, setConfirming] = useState(false);
  const [comparing, setComparing] = useState(false);
  if (q.isError) {
    return (
      <ErrorPanel
        forbiddenMessage={en.debriefs.noAccess}
        what={s.loadFailed}
        error={q.error}
        onRetry={() => void q.refetch()}
      />
    );
  }
  const d: DebriefReleaseDetail | undefined = q.data;
  if (!d) return <LoadingBlock lines={8} />;
  const live = d.status === "live";
  const prevLabel = d.previous ? releaseVersionLabel(d.previous.version) : null;

  const doRollback = async () => {
    try {
      await rollback({ id: d.id }).unwrap();
      toast.success(s.rolledBack);
      setConfirming(false);
    } catch (e) {
      toast.error(getErrorMessage(e, s.rollbackFailed));
    }
  };

  const rungName = en.debriefs.settingsPage.autonomy.columns;
  const rungs = d.evidence.beforeLive.ladder.map(r => ({
    name: rungName[r.rung] ?? codeWords(r.rung),
    state: RUNG_STATE[r.state],
    label: p.rung[r.state],
    detail: r.detail ?? "",
  }));
  const wl = d.evidence.whileLive;
  const stats = wl ? liveStats(wl, wl.previous, d.previous?.version ?? null) : [];

  return (
    <main
      className="flex min-w-0 max-w-[860px] flex-[999_1_560px] flex-col gap-5"
      data-testid="release-detail"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[22px] font-semibold">
          {releaseVersionLabel(d.version)} · {d.title}
        </h2>
        <ConsoleTag tone={live ? "success" : "neutral"}>
          {live ? s.live : d.retired?.reason === "rolled_back" ? p.rolledBack : p.retiredTag}
        </ConsoleTag>
        <span className="text-[13px] text-neutral-600">
          {live ? p.since(day(d.wentLiveAt)) : p.liveFromTo(day(d.wentLiveAt), day(d.retired?.at))}
        </span>
        <div className="flex-1" />
        {(d.can?.rollBack ?? (canAct && !live)) && (
          <Button kind="tertiary" size="sm" onClick={() => setConfirming(true)}>
            {p.rollBack}
          </Button>
        )}
      </div>
      <div className="text-[13px] text-neutral-600" data-testid="release-source">
        {originText(d)}
        {d.retired
          ? ` · ${
              d.retired.reason === "rolled_back"
                ? p.retiredRolledBack(d.retired.why)
                : p.retiredReplaced(d.retired.byVersion)
            }`
          : ""}
      </div>
      {confirming && (
        <div
          role="alertdialog"
          aria-label={p.confirmLabel}
          className="flex flex-wrap items-center gap-3 border-l-[3px] border-[#FF832B] bg-[#FFF2E8] px-4 py-3 text-sm"
          data-testid="rollback-confirm"
        >
          <div className="min-w-[16rem] flex-1">
            <b>{p.confirmTitle(releaseVersionLabel(d.version))}</b> {p.confirmBody}
          </div>
          <Button kind="primary" size="sm" disabled={isLoading} onClick={() => void doRollback()}>
            {s.rollbackConfirm}
          </Button>
          <Button kind="ghost" size="sm" onClick={() => setConfirming(false)}>
            {en.debriefs.pmAgent.cancel}
          </Button>
        </div>
      )}

      <section className="flex flex-col gap-3" data-testid="release-changes">
        <h3 className="text-[15px] font-semibold">
          {prevLabel ? p.whatChanged(prevLabel) : p.whatChangedFirst}
        </h3>
        {d.notes.summary ? (
          <p className="text-sm text-neutral-700">{d.notes.summary}</p>
        ) : (
          !d.notes.written && <p className="text-sm text-neutral-600">{p.noNotes}</p>
        )}
        {d.notes.changes.map((c, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-sm bg-neutral-50 px-4 py-3"
            data-testid="release-change"
          >
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <ConsoleTag tone="info">{c.area}</ConsoleTag>
              {c.what && <span className="font-semibold">{c.what}</span>}
            </div>
            {c.why && <div className="text-[13px] text-neutral-700">{p.why(c.why)}</div>}
            {(c.before || c.after) && (
              <div className="grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-2">
                <div className="whitespace-pre-wrap bg-white px-3 py-2">
                  <div className="text-xs text-neutral-600">{p.before}</div>
                  {c.before ?? "—"}
                </div>
                <div className="whitespace-pre-wrap bg-white px-3 py-2">
                  <div className="text-xs text-neutral-600">{p.after}</div>
                  {c.after ?? "—"}
                </div>
              </div>
            )}
          </div>
        ))}
        {prevLabel && (
          <p className="text-[13px] text-neutral-600">
            {p.restSame(prevLabel)}{" "}
            {d.compareWith && (
              <button
                type="button"
                className="text-primary-500 underline"
                onClick={() => setComparing(c => !c)}
              >
                {p.fullCompare}
              </button>
            )}
          </p>
        )}
        {comparing && d.compareWith && <FullCompare id={d.id} against={d.compareWith} />}
      </section>

      <EvidenceBlock
        title={p.didItWork}
        rungs={rungs}
        beforeTitle={p.beforeLive}
        afterTitle={live ? p.sinceLive : p.whileLive}
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
              {d.contents.prompts.map(x => (
                <li
                  key={x.code}
                  className="grid grid-cols-[minmax(0,1fr)_80px_110px_100px] gap-3 px-3 py-2 text-[13px]"
                >
                  <span>{promptName(x.code)}</span>
                  <span>
                    {x.followsCurrent ? p.current : x.version == null ? "—" : `v${x.version}`}
                  </span>
                  <span className={x.changed ? "text-primary-700" : "text-neutral-600"}>
                    {x.changed ? p.changed : p.unchanged}
                  </span>
                  <span className="text-neutral-600">
                    {x.lock === "pinned" ? p.pinnedLock : p.releaseOnly}
                  </span>
                </li>
              ))}
              {d.contents.recipes.map(r => (
                <li
                  key={r.key}
                  className="grid grid-cols-[minmax(0,1fr)_80px_110px_100px] gap-3 px-3 py-2 text-[13px]"
                >
                  <span>{p.recipe(recipeLabel(r.key))}</span>
                  <span>{r.maxRevisionRounds ?? "—"}</span>
                  <span className={r.changed ? "text-primary-700" : "text-neutral-600"}>
                    {r.changed ? p.changed : p.unchanged}
                  </span>
                  <span className="text-neutral-600">{p.releaseOnly}</span>
                </li>
              ))}
            </ul>
          </div>
          <div data-testid="steps-and-models">
            <div className="mb-2 text-sm font-semibold">{en.debriefs.pmPage.steps.heading}</div>
            <div className="overflow-x-auto rounded-sm bg-white">
              <div className="grid min-w-[760px] grid-cols-[150px_minmax(130px,1fr)_minmax(130px,1fr)_70px_70px_80px_70px] gap-3 border-b border-neutral-100 px-3 py-2 text-xs text-neutral-600">
                {[
                  p.cols.step,
                  p.cols.model,
                  p.cols.fallback,
                  p.cols.status,
                  p.cols.used,
                  p.cols.cost,
                  p.cols.win,
                ].map(h => (
                  <span key={h}>{h}</span>
                ))}
              </div>
              {d.contents.steps.map(st => (
                <div
                  key={st.step}
                  data-testid="model-row"
                  className="grid min-w-[760px] grid-cols-[150px_minmax(130px,1fr)_minmax(130px,1fr)_70px_70px_80px_70px] gap-3 border-b border-neutral-100 px-3 py-2 text-[13px]"
                >
                  <span className="font-medium">{stepName(st.step.replace(/^agent:/, ""))}</span>
                  <span title={st.model ?? undefined}>{st.model ? label(st.model) : "—"}</span>
                  <span className="text-neutral-600" title={st.backupModel ?? undefined}>
                    {st.backupModel ? label(st.backupModel) : p.noFallback}
                  </span>
                  <span>{p.stepStatus[st.status]}</span>
                  <span>{st.usedPct == null ? "—" : `${Math.round(st.usedPct)}%`}</span>
                  <span>{formatUsd(st.costPerRunUsd)}</span>
                  <span className="text-neutral-600">
                    {st.winRate == null ? "—" : `${Math.round(st.winRate * 100)}%`}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <div className="mb-2 text-sm font-semibold">{p.settingsHeading}</div>
              <ul className="flex flex-col gap-1 text-[13px]">
                {d.contents.settings.map(x => (
                  <li key={x.key} className={x.changed ? "text-primary-700" : ""}>
                    {en.debriefs.settings.names[x.key] ?? codeWords(x.key)}: {String(x.value)}
                  </li>
                ))}
              </ul>
              <Link to={settingsPath("tests")} className="mt-2 inline-block text-[13px]">
                {p.changeInSettings}
              </Link>
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold">
                {p.pinnedHeading} <span className="font-normal text-neutral-600">· {p.locked}</span>
              </div>
              <ul className="flex flex-col gap-1 text-[13px]">
                {d.contents.pinned.map(x => (
                  <li key={x.code}>
                    {x.label}: {x.version == null ? "—" : `v${x.version}`}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </details>
    </main>
  );
};

/**
 * PM agent › Releases (like a GitHub Releases page): only releases learners have had, newest
 * first, on the left; the one picked on the right with what changed, whether it worked, and
 * everything in it. Nothing live is edited here: a change starts as an idea ("Propose a change"),
 * and rolling back restores all of a release together.
 */
export const ReleasesView: React.FC<{
  canAct: boolean;
  onTheWay: number;
  selected: string | null;
  onSelect: (id: string) => void;
}> = ({ canAct, onTheWay, selected, onSelect }) => {
  const s = en.debriefs.releases;
  const p = en.debriefs.pmPage.releases;
  const history = useGetDebriefReleaseHistoryQuery();

  if (history.isError) {
    return (
      <div className="px-8 py-6">
        <ErrorPanel
          forbiddenMessage={en.debriefs.noAccess}
          what={s.loadFailed}
          error={history.error}
          onRetry={() => void history.refetch()}
        />
      </div>
    );
  }
  if (!history.data) {
    return (
      <div className="px-8 py-6">
        <LoadingBlock lines={6} />
      </div>
    );
  }
  const list = history.data.items;
  const sel = list.find(r => r.id === selected) ?? list.find(r => r.status === "live") ?? list[0];

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
      {(history.data.waiting ?? []).map(w => (
        <WaitingRelease key={w.id} release={w} canAct={canAct} />
      ))}
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
              return (
                <button
                  key={r.id}
                  type="button"
                  aria-current={on ? "true" : undefined}
                  data-testid="release-row"
                  onClick={() => onSelect(r.id)}
                  className={`flex flex-col gap-1 rounded-sm border-l-[3px] px-3 py-2.5 text-left ${on ? "border-primary-500 bg-neutral-50" : "border-transparent"}`}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{releaseVersionLabel(r.version)}</span>
                    <ConsoleTag tone={r.status === "live" ? "success" : "neutral"}>
                      {r.status === "live"
                        ? s.live
                        : r.retired?.reason === "rolled_back"
                          ? p.rolledBack
                          : p.retiredTag}
                    </ConsoleTag>
                  </span>
                  <span className="text-sm">{r.title}</span>
                  <span className="text-xs text-neutral-600">
                    {originText(r)} · {day(r.wentLiveAt)}
                  </span>
                </button>
              );
            })}
          </nav>
          <Detail key={sel.id} id={sel.id} canAct={canAct} />
        </div>
      )}
    </div>
  );
};
