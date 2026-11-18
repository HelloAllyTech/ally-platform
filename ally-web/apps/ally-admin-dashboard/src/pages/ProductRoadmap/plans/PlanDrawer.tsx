import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import { SkeletonText } from "@ally-ui-mono/ui-shared";
import {
  PlanCheck,
  PlanImpactTagId,
  PlanSuccessMeasure,
  PlanView,
  useAnswerAuthorQuestionMutation,
  useArchivePlanMutation,
  useAskPlanAuthorMutation,
  useClosePlanMutation,
  useConfirmClosePlanMutation,
  useDiscardPlanMutation,
  useDraftPlanLaunchMutation,
  useExportPlanMutation,
  useFilePlanMutation,
  useGetPlanCatchUpQuery,
  useGetPlanChecksQuery,
  useGetPlanOutcomesQuery,
  useGetPlanQuery,
  useHandBackPlanMutation,
  useMarkPlanLaunchItemMutation,
  usePlanResearchMutation,
  usePlanTurnMutation,
  useRecordPlanObservationMutation,
  useReopenPlanMutation,
  useResolvePlanFindingMutation,
  useRestorePlanMutation,
  useRunPlanChecksMutation,
  useSetPlanImpactTagsMutation,
  useSetPlanSuccessMeasureMutation,
  useTakeOnPlanMutation,
} from "@api";
import { Button } from "@components";
import { ButtonVariant } from "@components/types";
import { useUser } from "@hooks";

import { BuilderSessionDrawer } from "../BuilderSessionDrawer";
import {
  CHECK_LABEL,
  errorMessage,
  formatUsd,
  GATE_LABEL,
  STAGE_LABEL,
  TAG_LABEL,
  VERDICT_LABEL,
} from "./planLabels";
import { PlanProgress } from "./PlanProgress";

interface PlanDrawerProps {
  planId: string;
  onClose: () => void;
}

/** Wraps a mutation so every failure shows the server's own words. */
const run = async (action: () => Promise<unknown>, fallback: string, success?: string) => {
  try {
    await action();
    if (success) toast.success(success);
    return true;
  } catch (error) {
    toast.error(errorMessage(error, fallback));
    return false;
  }
};

/**
 * One plan, at whatever stage it is in (rev 5.2 §B.5–B.7). The idea stage is a private
 * conversation with the copilot and a "Ready to file" checklist. From filing on, the PRD,
 * design and build are written in the plan's Builder workspace (opened from here); this drawer
 * carries what makes the plan measurable and safe — success measure, impact tags, checks —
 * and the lead's actions, launch, outcomes and the history of who did what.
 */
export const PlanDrawer: React.FC<PlanDrawerProps> = ({ planId, onClose }) => {
  const { user } = useUser();
  const me = Number(user?.id ?? 0);
  const { data: plan, isLoading } = useGetPlanQuery(planId);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  if (workspaceOpen) {
    return (
      <BuilderSessionDrawer
        sessionId={planId}
        openingMessage={null}
        onClose={() => setWorkspaceOpen(false)}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex justify-end bg-black/30"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <aside
        className="bg-white relative flex h-full w-full max-w-3xl flex-col overflow-y-auto p-6"
        onClick={event => event.stopPropagation()}
        aria-label="Plan"
      >
        {isLoading || !plan ? (
          <SkeletonText paragraph lineCount={8} />
        ) : (
          <PlanBody
            plan={plan}
            me={me}
            onClose={onClose}
            onOpenWorkspace={() => setWorkspaceOpen(true)}
          />
        )}
      </aside>
    </div>
  );
};

const PlanBody: React.FC<{
  plan: PlanView;
  me: number;
  onClose: () => void;
  onOpenWorkspace: () => void;
}> = ({ plan, me, onClose, onOpenWorkspace }) => {
  const isLead = plan.leadUserId === me;
  const isAuthor = plan.authorUserId === me;
  const [exportPlan] = useExportPlanMutation();

  const download = async () => {
    try {
      const pkg = await exportPlan(plan.id).unwrap();
      for (const [content, ext, type] of [
        [pkg.markdown, "md", "text/markdown"],
        [JSON.stringify(pkg.json, null, 2), "json", "application/json"],
      ] as const) {
        const url = URL.createObjectURL(new Blob([content], { type }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `${pkg.filename}.${ext}`;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      toast.error(errorMessage(error, "Could not download the plan."));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{plan.title}</h2>
          <PlanProgress
            stage={plan.stage}
            caption={[
              plan.leadUserId ? `Lead: ${isLead ? "you" : `user ${plan.leadUserId}`}` : null,
              `Author: ${isAuthor ? "you" : `user ${plan.authorUserId}`}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          />
          {plan.spend && (
            <span className="text-xs text-typography-secondary">
              Spend {formatUsd(plan.spend.totalUsd)} of {formatUsd(plan.spend.ceilingUsd)}
              {plan.spend.approximate ? " (approximate)" : ""}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {plan.opportunityId && (
            <Button variant={ButtonVariant.SECONDARY} onClick={download}>
              Download plan
            </Button>
          )}
          <Button variant={ButtonVariant.TEXT} onClick={onClose} aria-label="Close">
            Close
          </Button>
        </div>
      </header>

      {plan.private ? (
        <IdeaStage plan={plan} onClose={onClose} />
      ) : (
        <>
          <LeadActions plan={plan} me={me} onOpenWorkspace={onOpenWorkspace} />
          <AuthorQuestions plan={plan} isAuthor={isAuthor} />
          {(isLead || plan.canLead) && <CatchUp planId={plan.id} />}
          <SuccessMeasure plan={plan} editable={isLead} />
          <ImpactTags plan={plan} editable={isLead} />
          <Checks planId={plan.id} isLead={isLead} />
          {isLead && <Research planId={plan.id} />}
          {(plan.stage === "launching" ||
            plan.stage === "measuring" ||
            plan.stage === "learned") && <Launch plan={plan} isLead={isLead} />}
          {(plan.stage === "measuring" || plan.stage === "learned") && (
            <Outcomes planId={plan.id} isLead={isLead} />
          )}
          <History plan={plan} />
        </>
      )}
    </div>
  );
};

// ── Idea stage ──────────────────────────────────────────────────────────────

const IdeaStage: React.FC<{ plan: PlanView; onClose: () => void }> = ({ plan, onClose }) => {
  const [text, setText] = useState("");
  const [productGoal, setProductGoal] = useState("");
  const [turn, { isLoading: isTurning }] = usePlanTurnMutation();
  const [file, { isLoading: isFiling }] = useFilePlanMutation();
  const [archive] = useArchivePlanMutation();
  const [restore] = useRestorePlanMutation();
  const [discard] = useDiscardPlanMutation();

  const send = async () => {
    const message = text.trim();
    if (!message) return;
    if (
      await run(
        () => turn({ id: plan.id, text: message }).unwrap(),
        "The copilot could not answer. Try again.",
      )
    ) {
      setText("");
    }
  };

  const gates = plan.idea.gates;
  const met = gates.filter(g => g.met).length;
  const needsGoal = plan.idea.readyToFile && !plan.idea.draft?.productGoal;

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Ready to file" className="border border-gray-200 p-4">
        <h3 className="text-sm font-semibold">
          {gates.length
            ? `Ready to file: ${met} of ${gates.length}`
            : "Ready to file: start the conversation"}
        </h3>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {gates.map(g => (
            <li key={g.id}>
              <span aria-hidden="true">{g.met ? "✓" : "○"}</span>{" "}
              <span className="sr-only">{g.met ? "Met:" : "Still needed:"}</span>
              {GATE_LABEL[g.id] ?? g.id}
              {!g.met && g.note ? (
                <span className="text-typography-secondary"> — {g.note}</span>
              ) : null}
            </li>
          ))}
        </ul>
        {plan.idea.readyToFile && (
          <div className="mt-3 flex flex-col gap-2">
            {plan.idea.draft && (
              <p className="text-sm">Voters will see: “{plan.idea.draft.description}”</p>
            )}
            {needsGoal && (
              <input
                className="border border-gray-300 p-2 text-sm"
                placeholder="Which product goal does this serve?"
                value={productGoal}
                onChange={event => setProductGoal(event.target.value)}
              />
            )}
            <Button
              disabled={isFiling || (needsGoal && !productGoal.trim())}
              onClick={() =>
                run(
                  () =>
                    file({ id: plan.id, productGoal: productGoal.trim() || undefined }).unwrap(),
                  "Could not file it.",
                  "Filed. It's on the roadmap for voting. We'll tell you when someone takes it on.",
                )
              }
            >
              File it
            </Button>
          </div>
        )}
      </section>

      <section aria-label="Conversation" className="flex flex-col gap-3">
        <ul className="flex flex-col gap-3" aria-live="polite">
          {plan.messages.map(m => (
            <li
              key={m.id}
              className={`max-w-[85%] whitespace-pre-wrap p-3 text-sm ${
                m.role === "author" ? "self-end bg-primary-50" : "self-start bg-gray-50"
              }`}
            >
              {m.content}
            </li>
          ))}
        </ul>
        {plan.archivedAt ? (
          <p className="text-sm">
            Archived after 30 quiet days.{" "}
            {plan.expiresAt ? `It will be deleted on ${plan.expiresAt.slice(0, 10)}.` : null}
          </p>
        ) : (
          <div className="flex gap-2">
            <textarea
              className="min-h-16 flex-1 border border-gray-300 p-2 text-sm"
              placeholder="Reply to the copilot…"
              value={text}
              onChange={event => setText(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            <Button disabled={isTurning || !text.trim()} onClick={send}>
              {isTurning ? "Thinking…" : "Send"}
            </Button>
          </div>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        {plan.archivedAt ? (
          <Button
            variant={ButtonVariant.SECONDARY}
            onClick={() => run(() => restore(plan.id).unwrap(), "Could not restore it.")}
          >
            Restore
          </Button>
        ) : (
          <Button
            variant={ButtonVariant.SECONDARY}
            onClick={() => run(() => archive(plan.id).unwrap(), "Could not archive it.")}
          >
            Archive
          </Button>
        )}
        <Button
          variant={ButtonVariant.DESTRUCTIVE}
          onClick={async () => {
            if (!window.confirm("Delete this idea for good? This cannot be undone.")) return;
            if (await run(() => discard(plan.id).unwrap(), "Could not delete it.")) onClose();
          }}
        >
          Delete
        </Button>
      </div>
    </div>
  );
};

// ── Lead ────────────────────────────────────────────────────────────────────

const LeadActions: React.FC<{ plan: PlanView; me: number; onOpenWorkspace: () => void }> = ({
  plan,
  me,
  onOpenWorkspace,
}) => {
  const [takeOn] = useTakeOnPlanMutation();
  const [handBack] = useHandBackPlanMutation();
  const [close] = useClosePlanMutation();
  const [confirmClose] = useConfirmClosePlanMutation();
  const [reopen] = useReopenPlanMutation();
  const [ask] = useAskPlanAuthorMutation();
  const isLead = plan.leadUserId === me;

  return (
    <section aria-label="Lead" className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {(isLead || plan.canLead) && plan.stage !== "closed" && (
          <Button onClick={onOpenWorkspace}>
            {isLead ? "Open the PRD workspace" : "Read the PRD workspace"}
          </Button>
        )}
        {plan.canLead && !plan.leadUserId && plan.stage !== "closed" && (
          <Button onClick={() => run(() => takeOn(plan.id).unwrap(), "Could not take it on.")}>
            Take this on
          </Button>
        )}
        {isLead && (
          <>
            <Button
              variant={ButtonVariant.SECONDARY}
              onClick={() => {
                const note =
                  window.prompt("A note for whoever takes it on next (optional)") ?? undefined;
                run(() => handBack({ id: plan.id, note }).unwrap(), "Could not hand it back.");
              }}
            >
              Hand back
            </Button>
            <Button
              variant={ButtonVariant.SECONDARY}
              onClick={() => {
                const question = window.prompt("Your question for the author");
                if (question?.trim())
                  run(
                    () => ask({ id: plan.id, question }).unwrap(),
                    "Could not send it.",
                    "Sent to the author.",
                  );
              }}
            >
              Ask the author
            </Button>
          </>
        )}
        {plan.canLead && !plan.closure && (!plan.leadUserId || isLead) && (
          <Button
            variant={ButtonVariant.DESTRUCTIVE}
            onClick={() => {
              const reason = window.prompt(
                "Why is this not being pursued? The author will read this.",
              );
              if (reason?.trim())
                run(() => close({ id: plan.id, reason }).unwrap(), "Could not close it.");
            }}
          >
            Close as not pursuing
          </Button>
        )}
        {plan.canLead && plan.closure?.pendingConfirmation && plan.closure.by !== me && (
          <Button
            variant={ButtonVariant.SECONDARY}
            title="Another Lead closed this; ideas with many votes need a second Lead"
            onClick={() => run(() => confirmClose(plan.id).unwrap(), "Could not confirm.")}
          >
            Confirm close
          </Button>
        )}
        {plan.canLead && plan.stage === "closed" && (
          <Button
            variant={ButtonVariant.SECONDARY}
            onClick={() => run(() => reopen(plan.id).unwrap(), "Could not reopen it.")}
          >
            Reopen
          </Button>
        )}
      </div>
      {plan.closure && (
        <p className="text-sm">
          {plan.closure.pendingConfirmation
            ? "Closing, waiting for a second Lead: "
            : "Not pursuing: "}
          {plan.closure.reason}
        </p>
      )}
    </section>
  );
};

const AuthorQuestions: React.FC<{ plan: PlanView; isAuthor: boolean }> = ({ plan, isAuthor }) => {
  const [answer] = useAnswerAuthorQuestionMutation();
  const open = plan.messages.filter(m => m.authorQuestion && !m.authorQuestion.answered);
  if (!open.length) return null;
  return (
    <section
      aria-label="Questions for the author"
      className="border border-primary-200 bg-primary-50 p-4"
    >
      <h3 className="text-sm font-semibold">Questions for the author</h3>
      <ul className="mt-2 flex flex-col gap-3">
        {open.map(m => (
          <li key={m.id} className="flex flex-col gap-2 text-sm">
            <span>{m.content.replace(/^Question for the author:\s*/, "")}</span>
            {isAuthor && (
              <Button
                variant={ButtonVariant.SECONDARY}
                onClick={() => {
                  const text = window.prompt("Your answer");
                  if (text?.trim() && m.authorQuestion) {
                    run(
                      () =>
                        answer({
                          id: plan.id,
                          questionId: m.authorQuestion!.id,
                          answer: text,
                        }).unwrap(),
                      "Could not send your answer.",
                      "Sent to the lead.",
                    );
                  }
                }}
              >
                Answer
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};

const CatchUp: React.FC<{ planId: string }> = ({ planId }) => {
  const { data } = useGetPlanCatchUpQuery(planId);
  if (!data) return null;
  return (
    <section aria-label="Catch-up" className="border border-gray-200 p-4 text-sm">
      <h3 className="font-semibold">Catch-up</h3>
      <p className="mt-1">
        {data.readiness.ready ? "The PRD is ready for design." : "Before design can start:"}
      </p>
      {!data.readiness.ready && (
        <ul className="ml-5 list-disc">
          {data.readiness.blockers.map(b => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {data.handBackNote && <p className="mt-2">Note from the last lead: {data.handBackNote}</p>}
      {data.lastAnswers.length > 0 && (
        <>
          <p className="mt-2 font-medium">Latest answers</p>
          <ul className="ml-5 list-disc">
            {data.lastAnswers.map(a => (
              <li key={a.at + a.content.slice(0, 20)}>{a.content.slice(0, 240)}</li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-2 text-typography-secondary">Spent so far: {formatUsd(data.spendUsd)}</p>
    </section>
  );
};

// ── Success measure and impact tags ─────────────────────────────────────────

const emptyMeasure: PlanSuccessMeasure = {
  metric: "",
  baseline: null,
  target: "",
  guardrails: [],
  method: { kind: "analytics_question", spec: "" },
  reviewAfterDays: [14, 45],
};

const SuccessMeasure: React.FC<{ plan: PlanView; editable: boolean }> = ({ plan, editable }) => {
  const { data: catchUp } = useGetPlanCatchUpQuery(plan.id, { skip: !editable });
  const [save, { isLoading }] = useSetPlanSuccessMeasureMutation();
  const [draft, setDraft] = useState<PlanSuccessMeasure>(emptyMeasure);
  const [guardrails, setGuardrails] = useState("");
  const [reviewDays, setReviewDays] = useState("14, 45");

  useEffect(() => {
    const current = catchUp?.successMeasure;
    if (current) {
      setDraft(current);
      setGuardrails(current.guardrails.join("\n"));
      setReviewDays(current.reviewAfterDays.join(", "));
    }
  }, [catchUp?.successMeasure]);

  if (!editable) return null;
  const frozen = !!catchUp?.measureFrozen;
  const field = "border border-gray-300 p-2 text-sm";

  const submit = async () => {
    const measure: PlanSuccessMeasure = {
      ...draft,
      guardrails: guardrails
        .split("\n")
        .map(g => g.trim())
        .filter(Boolean),
      reviewAfterDays: reviewDays
        .split(",")
        .map(d => Number(d.trim()))
        .filter(d => Number.isInteger(d) && d > 0),
    };
    let changeReason: string | undefined;
    if (frozen) {
      changeReason =
        window.prompt("The success measure is frozen. Why does it have to change?") ?? undefined;
      if (!changeReason?.trim()) return;
    }
    await run(
      () => save({ id: plan.id, measure, changeReason }).unwrap(),
      "Could not save the success measure.",
      "Saved.",
    );
  };

  return (
    <section
      aria-label="Success measure"
      className="flex flex-col gap-2 border border-gray-200 p-4"
    >
      <h3 className="text-sm font-semibold">Success measure{frozen ? " (frozen)" : ""}</h3>
      <p className="text-xs text-typography-secondary">
        What should move, by how much, and how the outcome review will check it. It freezes when the
        design is approved.
      </p>
      <input
        className={field}
        placeholder="Metric, e.g. learners back within 7 days of a missed week"
        value={draft.metric}
        onChange={e => setDraft({ ...draft, metric: e.target.value })}
      />
      <input
        className={field}
        placeholder="Baseline (leave empty if there is none yet)"
        value={draft.baseline ?? ""}
        onChange={e =>
          setDraft({ ...draft, baseline: e.target.value.trim() ? e.target.value : null })
        }
      />
      <input
        className={field}
        placeholder="Target"
        value={draft.target}
        onChange={e => setDraft({ ...draft, target: e.target.value })}
      />
      <textarea
        className={field}
        placeholder="Guardrail metrics that must not get worse, one per line"
        value={guardrails}
        onChange={e => setGuardrails(e.target.value)}
      />
      <select
        className={field}
        value={draft.method.kind}
        onChange={e =>
          setDraft({
            ...draft,
            method: {
              ...draft.method,
              kind: e.target.value as PlanSuccessMeasure["method"]["kind"],
            },
          })
        }
      >
        <option value="analytics_question">
          Measured by an analytics question (asked automatically)
        </option>
        <option value="manual">Judged by hand (the lead records what was observed)</option>
      </select>
      <textarea
        className={field}
        placeholder={
          draft.method.kind === "manual"
            ? "How it will be judged"
            : "The analytics question, e.g. What share of learners who missed a week came back within 7 days, by month?"
        }
        value={draft.method.spec}
        onChange={e => setDraft({ ...draft, method: { ...draft.method, spec: e.target.value } })}
      />
      <input
        className={field}
        placeholder="Review after (days), e.g. 14, 45"
        value={reviewDays}
        onChange={e => setReviewDays(e.target.value)}
      />
      <Button disabled={isLoading} onClick={submit}>
        Save success measure
      </Button>
    </section>
  );
};

const ALL_TAGS = Object.keys(TAG_LABEL) as PlanImpactTagId[];

const ImpactTags: React.FC<{ plan: PlanView; editable: boolean }> = ({ plan, editable }) => {
  const { data: catchUp } = useGetPlanCatchUpQuery(plan.id, { skip: !editable });
  const [save] = useSetPlanImpactTagsMutation();
  if (!editable || !catchUp) return null;
  const code = new Set(catchUp.impactTags.filter(t => t.source === "code").map(t => t.id));
  const chosen = new Set(catchUp.impactTags.map(t => t.id));
  const toggle = (tag: PlanImpactTagId) => {
    const next = new Set(chosen);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    const leadTags = [...next].filter(t => !code.has(t));
    run(() => save({ id: plan.id, tags: leadTags }).unwrap(), "Could not save that.");
  };
  return (
    <section aria-label="What does this touch?" className="border border-gray-200 p-4">
      <h3 className="text-sm font-semibold">What does this touch?</h3>
      <p className="text-xs text-typography-secondary">
        Decides which checks the plan needs. Ticks found in the code cannot be removed.
      </p>
      <ul className="mt-2 grid grid-cols-1 gap-1 text-sm md:grid-cols-2">
        {ALL_TAGS.map(tag => (
          <li key={tag}>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={chosen.has(tag)}
                disabled={code.has(tag)}
                onChange={() => toggle(tag)}
              />
              {TAG_LABEL[tag]}
              {code.has(tag) ? (
                <span className="text-xs text-typography-secondary">(found in code)</span>
              ) : null}
            </label>
          </li>
        ))}
      </ul>
      {catchUp.requiredChecks.length > 0 && (
        <p className="mt-2 text-xs">
          Checks needed: {catchUp.requiredChecks.map(c => CHECK_LABEL[c]).join(" · ")}
        </p>
      )}
    </section>
  );
};

// ── Checks ──────────────────────────────────────────────────────────────────

const Checks: React.FC<{ planId: string; isLead: boolean }> = ({ planId, isLead }) => {
  const { data: checks } = useGetPlanChecksQuery(planId);
  const [runChecks, { isLoading }] = useRunPlanChecksMutation();
  const [resolve] = useResolvePlanFindingMutation();

  const resolveFinding = (
    check: PlanCheck,
    findingId: string,
    kind: "fixed" | "dismissed",
    high: boolean,
  ) => {
    const reason = window.prompt(
      high
        ? "This is a high-severity finding. Explain how it is handled, in a sentence or two. Every later lead will see this."
        : "Why? Every later lead will see this.",
    );
    if (!reason?.trim()) return;
    run(
      () => resolve({ id: planId, kind: check.kind, findingId, resolution: kind, reason }).unwrap(),
      "Could not resolve it.",
    );
  };

  return (
    <section aria-label="Checks" className="flex flex-col gap-2 border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Checks</h3>
        {isLead && (
          <Button
            variant={ButtonVariant.SECONDARY}
            disabled={isLoading}
            onClick={() => run(() => runChecks(planId).unwrap(), "The checks could not run.")}
          >
            {isLoading ? "Running…" : "Run checks"}
          </Button>
        )}
      </div>
      {!checks?.length && (
        <p className="text-sm text-typography-secondary">No checks have run yet.</p>
      )}
      {checks?.map(check => (
        <div key={check.id} className="text-sm">
          <p className="font-medium">
            {CHECK_LABEL[check.kind]} —{" "}
            {check.status === "resolved"
              ? "resolved"
              : check.status === "running"
                ? "running"
                : check.status === "failed"
                  ? "could not run"
                  : "needs action"}
            {check.mode === "shadow" ? " (advisory while this check is new)" : ""}
          </p>
          {check.error && <p className="text-xs">{check.error}</p>}
          <ul className="ml-5 list-disc">
            {check.findings.map(f => (
              <li key={f.id} className="mt-1">
                <span className="font-medium">
                  {f.severity === "high"
                    ? "High: "
                    : f.severity === "medium"
                      ? "Medium: "
                      : "Low: "}
                </span>
                {f.title} — {f.detail}
                {f.mitigation ? (
                  <span className="text-typography-secondary"> Suggested: {f.mitigation}</span>
                ) : null}
                {f.resolution ? (
                  <p className="text-xs text-typography-secondary">
                    {f.resolution.kind === "fixed" ? "Fixed" : "Dismissed"} by user{" "}
                    {f.resolution.by}: {f.resolution.reason}
                  </p>
                ) : (
                  isLead && (
                    <span className="ml-2 inline-flex gap-2">
                      <button
                        type="button"
                        className="text-xs underline"
                        onClick={() => resolveFinding(check, f.id, "fixed", f.severity === "high")}
                      >
                        Fixed in the PRD
                      </button>
                      <button
                        type="button"
                        className="text-xs underline"
                        onClick={() =>
                          resolveFinding(check, f.id, "dismissed", f.severity === "high")
                        }
                      >
                        Resolve with a reason
                      </button>
                    </span>
                  )
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
};

const Research: React.FC<{ planId: string }> = ({ planId }) => {
  const [plan, { data, isLoading }] = usePlanResearchMutation();
  return (
    <section
      aria-label="Test the riskiest assumption"
      className="border border-gray-200 p-4 text-sm"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Test the riskiest assumption</h3>
        <Button
          variant={ButtonVariant.SECONDARY}
          disabled={isLoading}
          onClick={() => run(() => plan(planId).unwrap(), "Could not plan the research.")}
        >
          {data ? "Plan it again" : "Plan a test"}
        </Button>
      </div>
      {data && (
        <div className="mt-2 flex flex-col gap-1">
          <p>Assumption: {data.assumption}</p>
          <p>Talk to: {data.who}</p>
          <ol className="ml-5 list-decimal">
            {data.questions.map(q => (
              <li key={q}>{q}</li>
            ))}
          </ol>
          {data.alternativeTest && <p>Or test it with: {data.alternativeTest}</p>}
          <p>Decide in advance: {data.decisionRule}</p>
        </div>
      )}
    </section>
  );
};

// ── Launch and outcomes ─────────────────────────────────────────────────────

const Launch: React.FC<{ plan: PlanView; isLead: boolean }> = ({ plan, isLead }) => {
  const [draft, { data: drafted, isLoading }] = useDraftPlanLaunchMutation();
  const [mark] = useMarkPlanLaunchItemMutation();
  const launch = drafted;
  return (
    <section aria-label="Launch" className="flex flex-col gap-2 border border-gray-200 p-4 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Launch</h3>
        {isLead && plan.stage === "launching" && (
          <Button
            variant={ButtonVariant.SECONDARY}
            disabled={isLoading}
            onClick={() => run(() => draft(plan.id).unwrap(), "Could not draft the launch.")}
          >
            {launch ? "Draft again" : "Draft launch materials"}
          </Button>
        )}
      </div>
      <p className="text-xs text-typography-secondary">
        Drafts only. Publish each one yourself — the product update in Product Updates, tooltips in
        Manage Tooltips — then tick it off.
      </p>
      {launch?.items.map(item => (
        <div key={item.id} className="border-t border-gray-100 pt-2">
          <label className="flex items-center gap-2 font-medium">
            <input
              type="checkbox"
              checked={item.done}
              disabled={!isLead}
              onChange={event =>
                run(
                  () => mark({ id: plan.id, itemId: item.id, done: event.target.checked }).unwrap(),
                  "Could not update that.",
                )
              }
            />
            {item.title}
          </label>
          <p className="whitespace-pre-wrap">{item.body}</p>
        </div>
      ))}
    </section>
  );
};

const Outcomes: React.FC<{ planId: string; isLead: boolean }> = ({ planId, isLead }) => {
  const { data } = useGetPlanOutcomesQuery(planId);
  const [record] = useRecordPlanObservationMutation();
  return (
    <section aria-label="Outcomes" className="border border-gray-200 p-4 text-sm">
      <h3 className="font-semibold">Outcomes</h3>
      {!data?.length && (
        <p className="text-typography-secondary">
          The first outcome review runs on the date set in the success measure.
        </p>
      )}
      <ul className="mt-2 flex flex-col gap-2">
        {data?.map(o => (
          <li key={o.id}>
            <p className="font-medium">
              {o.dueDate}: {VERDICT_LABEL[o.verdict] ?? o.verdict}
              {o.chunkCode ? ` · ${o.chunkCode}` : ""}
            </p>
            <p>{o.reasons}</p>
            {isLead && o.nextSteps.length > 0 && (
              <ul className="ml-5 list-disc">
                {o.nextSteps.map(s => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {isLead && (
        <button
          type="button"
          className="mt-2 text-xs underline"
          onClick={() => {
            const dueDate = window.prompt("Review date (YYYY-MM-DD)");
            const observed = dueDate ? window.prompt("What did you observe?") : null;
            if (dueDate && observed?.trim()) {
              run(() => record({ id: planId, dueDate, observed }).unwrap(), "Could not record it.");
            }
          }}
        >
          Record an observation for a hand-judged measure
        </button>
      )}
    </section>
  );
};

const EVENT_LABEL: Record<string, string> = {
  parked: "Parked",
  filed: "Filed",
  taken_on: "Taken on",
  handed_back: "Handed back",
  auto_released: "Handed back automatically",
  stage_changed: "Moved on",
  archived: "Archived",
  restored: "Restored",
  visibility_changed: "Shared",
  author_asked: "Asked the author",
  budget_changed: "Budget changed",
  check_required: "Check ran",
  check_resolved: "Finding fixed",
  finding_dismissed: "Finding resolved with a reason",
  measure_frozen: "Success measure frozen",
  measure_changed: "Success measure changed",
  design_started: "Design started",
  design_approved: "Design approved",
  build_sent: "Sent to build",
  exported: "Downloaded",
  launched: "Launched",
  outcome_reviewed: "Outcome reviewed",
  closed: "Closed as not pursuing",
  reopened: "Reopened",
};

const History: React.FC<{ plan: PlanView }> = ({ plan }) => (
  <section aria-label="History" className="text-sm">
    <h3 className="font-semibold">Who did what</h3>
    <ol className="mt-2 flex flex-col gap-1">
      {[...plan.events].reverse().map((e, i) => {
        const detail = e.detail as { to?: string; reason?: string } | null;
        return (
          <li key={`${e.at}-${i}`} className="text-typography-secondary">
            {e.at.slice(0, 16).replace("T", " ")} · {EVENT_LABEL[e.kind] ?? e.kind}
            {e.kind === "stage_changed" && detail?.to
              ? ` to ${STAGE_LABEL[detail.to as keyof typeof STAGE_LABEL] ?? detail.to}`
              : ""}
            {e.actorUserId ? ` · user ${e.actorUserId}` : " · automatic"}
          </li>
        );
      })}
    </ol>
  </section>
);
