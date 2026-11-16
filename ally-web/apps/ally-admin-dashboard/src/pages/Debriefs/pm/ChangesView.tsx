import React, { useState } from "react";

import { toast } from "sonner";

import { Button } from "@ally-ui-mono/ui-shared";
import {
  useGetDebriefChangeQuery,
  useGetDebriefChangesQuery,
  useGetDebriefHomeQuery,
  useStopDebriefChangeMutation,
  useUndoDebriefChangeMutation,
} from "@api";
import { EmptyPanel, ErrorPanel, LoadingBlock } from "@components/ally-guide/ConsoleStates";
import { en } from "@constants";
import { ChangeState, DebriefChange, PmAbout } from "@types";
import { getErrorMessage } from "@utils";

import { languageLabel } from "../consoleLabels";
import { DebriefAccess } from "../debriefAccess";
import { Wording, WholeRule } from "./ChangeText";
import { DecisionButtons } from "./DecisionButtons";
import { PmConversation } from "./PmConversation";

/** The five groups of the Changes list (V2_AUTONOMY U3), in order. */
export const CHANGE_GROUPS = [
  "waits",
  "trying",
  "testing",
  "proposed",
  "building",
  "live",
  "undone",
] as const;
export type ChangeGroup = (typeof CHANGE_GROUPS)[number];

/**
 * Which group a change sits in. Being tested (before any learner) sits with the changes being
 * tried: both can be stopped, and neither is live yet. Stopped and turned down sit with Undone.
 */
export const groupOf = (state: ChangeState): ChangeGroup => {
  switch (state) {
    case "waits":
      return "waits";
    case "trying":
      return "trying";
    case "testing":
      return "testing";
    case "proposed":
      return "proposed";
    case "building":
      return "building";
    case "live":
      return "live";
    default:
      return "undone";
  }
};

const GROUP_DOT: Record<ChangeGroup, string> = {
  waits: "bg-[#F1C21B]",
  trying: "bg-primary-500",
  testing: "bg-primary-300",
  proposed: "bg-neutral-300",
  building: "bg-[#8A3FFC]",
  live: "bg-success-500",
  undone: "bg-neutral-500",
};

const STATE_TAG: Record<ChangeGroup, string> = {
  waits: "bg-[#FFF2E8] text-[#8A3800]",
  trying: "bg-primary-50 text-primary-700",
  testing: "bg-primary-50 text-primary-700",
  proposed: "bg-neutral-100 text-neutral-900",
  building: "bg-[#E8DAFF] text-[#491D8B]",
  live: "bg-success-50 text-success-600",
  undone: "bg-neutral-100 text-neutral-900",
};

/**
 * Whether this change is one the clinical advisor takes part in: a pinned-rule change that waits
 * for a person. ally-be names the kind in words ("Pinned rule · Safety reader").
 */
export const isPinnedRuleChange = (c: DebriefChange) =>
  c.state === "waits" && /^pinned rule/i.test(c.kind);

/**
 * The changes this viewer sees: everything for the Ally team and the owner; only pinned-rule
 * changes that wait for a person for the clinical advisor (who approves pinned rules but does not
 * run the PM agent).
 */
export const visibleChanges = (all: DebriefChange[], access: DebriefAccess): DebriefChange[] =>
  access.pmAgent ? all : access.approvePinnedRule ? all.filter(isPinnedRuleChange) : [];

const TONE_FG: Record<string, string> = {
  up: "text-success-600",
  down: "text-destructive-600",
  flat: "text-typography-900",
};
const STEP_TONE: Record<string, string> = {
  pass: "bg-success-50 text-success-600",
  fail: "bg-destructive-50 text-destructive-600",
  wait: "bg-white text-neutral-700",
};

const Detail: React.FC<{ change: DebriefChange; canAct: boolean; access: DebriefAccess }> = ({
  change,
  canAct,
  access,
}) => {
  const c = en.debriefs.v2.changes;
  const [undo, undoing] = useUndoDebriefChangeMutation();
  const [stop, stopping] = useStopDebriefChangeMutation();
  const group = groupOf(change.state);
  // Undo now and Stop now need the releases permission (the Ally team and the owner).
  const canStop = canAct && change.canStop;
  const canUndo = canAct && change.canUndo;
  const act = async (which: "undo" | "stop") => {
    try {
      await (which === "undo" ? undo(change.id) : stop(change.id)).unwrap();
      toast.success(which === "undo" ? c.undone : c.stopped);
    } catch (e) {
      toast.error(getErrorMessage(e, c.actionFailed));
    }
  };
  const tags = [
    change.confidence ? c.confidence[change.confidence] : null,
    change.languages?.length ? c.languages(change.languages.map(languageLabel).join(", ")) : null,
  ].filter(Boolean) as string[];
  return (
    <article className="flex min-w-0 flex-col gap-4" data-testid="change-detail">
      <div className="flex min-w-0 flex-nowrap items-center gap-2 text-[13px]">
        <span className="shrink-0 text-neutral-600">{change.kind}</span>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATE_TAG[group]}`}
          data-testid="change-state"
        >
          {c.state[change.state] ?? change.state}
        </span>
        {tags.map(t => (
          <span
            key={t}
            className="shrink-0 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-900"
          >
            {t}
          </span>
        ))}
        <span className="min-w-0 truncate text-neutral-600">{change.when}</span>
      </div>
      {/* A waiting change's result only repeats why it waits: the title leads instead. */}
      <h2 className="m-0 font-secondary text-[22px] font-normal leading-snug">
        {change.state === "waits" ? change.title : change.result}
      </h2>
      {change.state === "waits" && (
        <p className="m-0 text-sm text-neutral-700" data-testid="change-waits-note">
          {change.waitsBecause ?? c.waitsShort}
        </p>
      )}
      {change.wording && <Wording before={change.wording.before} after={change.wording.after} />}
      {change.rule && <WholeRule rule={change.rule} changed={!!change.wording} />}
      <DecisionButtons change={change} access={access} />
      {/* The title already leads a waiting change; a reason shows only when someone gave one. */}
      {(change.state !== "waits" || change.why) && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {change.state !== "waits" && (
            <div className="flex flex-col gap-1 rounded-sm bg-neutral-50 px-4 py-3 text-sm">
              <div className="text-xs text-neutral-600">{c.theChange}</div>
              {change.title}
            </div>
          )}
          {change.why && (
            <div className="flex flex-col gap-1 rounded-sm bg-neutral-50 px-4 py-3 text-sm">
              <div className="text-xs text-neutral-600">{c.why}</div>
              {change.why}
            </div>
          )}
        </div>
      )}
      {change.measures.length > 0 && (
        <div
          className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-px bg-neutral-100"
          data-testid="change-measures"
        >
          {change.measures.map(m => (
            <div key={m.name} className="flex flex-col gap-1 bg-white px-3.5 py-3">
              <div className="truncate text-xs text-neutral-600" title={m.name}>
                {m.name}
              </div>
              <div className={`text-base font-semibold ${TONE_FG[m.tone] ?? ""}`}>{m.value}</div>
            </div>
          ))}
        </div>
      )}
      {change.steps.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-neutral-600">{c.whereItIs}</div>
          <ol className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="change-steps">
            {change.steps.map(st => (
              <li
                key={st.name}
                className={`flex min-w-0 flex-nowrap items-center gap-3 rounded-sm px-3 py-2 text-sm ${STEP_TONE[st.tone] ?? ""}`}
              >
                <span className="w-36 shrink-0 font-semibold">{st.name}</span>
                <span className="w-28 shrink-0">{st.state}</span>
                <span className="min-w-0 truncate text-neutral-700" title={st.detail}>
                  {st.detail}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {(canStop || canUndo) && (
        <div className="flex flex-nowrap items-center gap-3">
          {canStop && (
            <span title={c.stopHelp}>
              <Button
                kind="danger--tertiary"
                size="md"
                disabled={stopping.isLoading}
                onClick={() => void act("stop")}
              >
                {c.stopNow}
              </Button>
            </span>
          )}
          {canUndo && (
            <span title={c.undoHelp}>
              <Button
                kind="danger--tertiary"
                size="md"
                disabled={undoing.isLoading}
                onClick={() => void act("undo")}
              >
                {c.undoNow}
              </Button>
            </span>
          )}
        </div>
      )}
      {change.basedOn && <p className="m-0 text-[13px] text-neutral-600">{change.basedOn}</p>}
    </article>
  );
};

/**
 * Changes › Changes (U3): the grouped list, the selected change in detail, and the one PM agent
 * conversation beside it. Approving, turning down and retrying happen in the conversation; the
 * only buttons are Undo now and Stop now, which need no model.
 */
export const ChangesView: React.FC<{
  access: DebriefAccess;
  selected: string | null;
  onSelect: (id: string) => void;
}> = ({ access, selected, onSelect }) => {
  const c = en.debriefs.v2.changes;
  const [allMessages, setAllMessages] = useState(false);
  const q = useGetDebriefChangesQuery();
  const home = useGetDebriefHomeQuery(undefined, { skip: !access.pmAgent });
  const items = visibleChanges(q.data ?? [], access);
  const groups = CHANGE_GROUPS.map(g => ({
    id: g,
    items: items.filter(i => groupOf(i.state) === g),
  })).filter(g => g.items.length > 0);
  const ordered = groups.flatMap(g => g.items);
  const current = ordered.find(i => i.id === selected) ?? ordered[0] ?? null;
  // The list's row is shown at once; the detail endpoint's answer replaces it when it lands.
  const detail = useGetDebriefChangeQuery(current?.id ?? "", { skip: !current });
  const shown = detail.data && detail.data.id === current?.id ? detail.data : current;
  const canTalk = access.pmAgent || access.approvePinnedRule;
  const count = (g: ChangeGroup) => groups.find(x => x.id === g)?.items.length ?? 0;
  const headline = c.headline(
    home.data?.thisWeek.wentLive ?? count("live"),
    count("trying"),
    count("waits"),
  );
  const about: PmAbout = shown
    ? { kind: "change", id: shown.id, label: shown.title }
    : { kind: "page", id: "changes", label: c.title };

  if (q.isError && !q.data) {
    return (
      <div className="px-8 py-6">
        <ErrorPanel
          forbiddenMessage={en.debriefs.noAccess}
          what={c.loadFailed}
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="px-8 py-6">
        <LoadingBlock lines={8} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5 px-8 py-6" data-testid="changes-view">
      {access.pmAgent && (
        <p className="m-0 max-w-[980px] text-lg font-light" data-testid="changes-headline">
          {headline.lead}
          <b className="font-semibold">{headline.bold}</b>
        </p>
      )}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[260px_minmax(0,1fr)_380px]">
        <aside aria-label={c.title} className="flex flex-col gap-4" data-testid="changes-list">
          {groups.length === 0 && <EmptyPanel title={c.empty.title} message={c.empty.message} />}
          {groups.map(g => (
            <section
              key={g.id}
              className="flex flex-col gap-1"
              data-testid={`changes-group-${g.id}`}
            >
              <h2 className="m-0 flex items-center gap-2 text-xs font-semibold tracking-[.32px] text-neutral-600">
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${GROUP_DOT[g.id]}`} />
                {c.groups[g.id]}
                <span className="font-normal">{g.items.length}</span>
              </h2>
              {g.items.map(i => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => onSelect(i.id)}
                  aria-current={i.id === shown?.id ? "true" : undefined}
                  data-testid="change-item"
                  className={`flex min-w-0 flex-col items-start gap-0.5 border-l-2 px-3 py-2 text-left ${i.id === shown?.id ? "border-primary-500 bg-neutral-50" : "border-transparent bg-transparent"}`}
                >
                  <span className="w-full truncate text-sm font-semibold" title={i.title}>
                    {i.title}
                  </span>
                  <span className="w-full truncate text-xs text-neutral-600">
                    {[i.kind, i.when].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ))}
            </section>
          ))}
        </aside>
        <main className="min-w-0">
          {shown ? (
            <Detail change={shown} canAct={access.releases} access={access} />
          ) : groups.length > 0 ? (
            <p className="text-sm text-neutral-600">{c.pick}</p>
          ) : null}
        </main>
        {canTalk && (
          <PmConversation
            key={allMessages || !shown ? "all" : shown.id}
            testId="changes-pm"
            className="rounded-sm border border-neutral-100"
            about={about}
            // Each change shows its own conversation; "All messages" shows the whole thread.
            scoped={!!shown && !allMessages}
            headerAction={
              shown ? (
                <button
                  type="button"
                  className="text-[13px] font-semibold text-primary-500"
                  onClick={() => setAllMessages(v => !v)}
                  data-testid="changes-pm-scope"
                >
                  {allMessages ? c.thisChangeOnly : c.allMessages}
                </button>
              ) : undefined
            }
            suggestions={
              en.debriefs.v2.conversation.suggestions[shown ? shown.state : "page"] ?? []
            }
          />
        )}
      </div>
    </div>
  );
};
