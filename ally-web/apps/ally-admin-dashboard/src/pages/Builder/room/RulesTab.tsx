import React, { useMemo, useState } from "react";

import { ThreeDot } from "@icons";
import { toast } from "sonner";

import {
  useCreateBuilderRuleMutation,
  useDismissBuilderRuleProposalMutation,
  useGetBuilderRuleProposalsQuery,
  useGetBuilderRulesQuery,
  useSetBuilderRuleActiveMutation,
} from "@api";
import { en } from "@constants";
import { BuilderRule } from "@types";

const strings = en.builder.room.rules;
const kindLabels = en.builder.decisions.kinds;

interface RulesTabProps {
  lastHistoryId: string | null;
  onNewRule: () => void;
  onRuleFromLast: () => void;
  onEdit: (rule: BuilderRule) => void;
  onHistory: (rule: BuilderRule) => void;
}

const relative = (iso: string | null): string => {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
};

/**
 * Rules read like a short document grouped by area, not a feed: they are the
 * product's taste written down. Builder's "Shall I…?" offers sit on top, and
 * each is a yes/no — never assumed.
 */
export const RulesTab: React.FC<RulesTabProps> = ({
  lastHistoryId,
  onNewRule,
  onRuleFromLast,
  onEdit,
  onHistory,
}) => {
  const { data: rules, isLoading, isError, refetch } = useGetBuilderRulesQuery();
  const { data: proposals = [] } = useGetBuilderRuleProposalsQuery();
  const [setActive] = useSetBuilderRuleActiveMutation();
  const [createRule] = useCreateBuilderRuleMutation();
  const [dismiss] = useDismissBuilderRuleProposalMutation();
  const [menu, setMenu] = useState<string | null>(null);

  const areas = useMemo(() => {
    const map = new Map<string, BuilderRule[]>();
    for (const rule of rules ?? []) {
      const list = map.get(rule.area) ?? [];
      list.push(rule);
      map.set(rule.area, list);
    }
    return [...map.entries()];
  }, [rules]);

  const toggle = async (rule: BuilderRule) => {
    setMenu(null);
    try {
      await setActive({ id: rule.id, active: !rule.active }).unwrap();
      toast(rule.active ? strings.turnedOff : strings.turnedOn);
    } catch {
      toast.error(en.builder.room.editor.failed);
    }
  };

  return (
    <div className="flex max-w-[880px] flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-normal leading-9">{strings.title}</h1>
          <p className="mt-1 max-w-[62ch] text-sm text-typography-600">{strings.subtitle}</p>
        </div>
        <button
          type="button"
          className="min-h-[40px] border border-typography-900 px-4 text-sm"
          onClick={onNewRule}
        >
          {strings.newRule}
        </button>
      </header>

      {proposals.length > 0 && (
        <section aria-label={strings.proposals.title} className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold tracking-wide text-typography-600">
            {strings.proposals.title}
          </h2>
          {proposals.map(proposal => (
            <div key={proposal.key} className="border border-border-light bg-white px-4 py-3">
              <p className="text-xs text-typography-500">
                {kindLabels[proposal.kind] ?? proposal.kind}
              </p>
              <p className="mt-1 text-base">
                {strings.proposals.ask(proposal.optionLabel, proposal.streak)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="min-h-[40px] border border-typography-900 px-4 text-sm"
                  onClick={async () => {
                    try {
                      await createRule({
                        statement: `Builder decides: choose "${proposal.optionLabel}" for ${(
                          kindLabels[proposal.kind] ?? proposal.kind
                        ).toLowerCase()} decisions.`,
                        scope: "everywhere",
                        effect: "decide",
                        match: {
                          kind: proposal.kind,
                          questionType: proposal.questionType,
                          optionId: proposal.optionId,
                        },
                      }).unwrap();
                      toast.success(en.builder.room.editor.saved);
                    } catch {
                      toast.error(en.builder.room.editor.failed);
                    }
                  }}
                >
                  {strings.proposals.yesEverywhere}
                </button>
                <button
                  type="button"
                  className="min-h-[40px] px-4 text-sm underline underline-offset-2"
                  onClick={() => dismiss(proposal.key)}
                >
                  {strings.proposals.notYet}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {isError ? (
        <div className="text-sm">
          <p>{strings.loadFailed}</p>
          <button type="button" className="mt-2 underline" onClick={() => refetch()}>
            {en.builder.room.card.retry}
          </button>
        </div>
      ) : isLoading ? null : !areas.length ? (
        <div className="max-w-[60ch] text-sm text-typography-700">
          <p>{strings.emptyBody}</p>
          {lastHistoryId && (
            <button
              type="button"
              className="mt-4 min-h-[40px] border border-typography-900 px-4"
              onClick={onRuleFromLast}
            >
              {strings.fromLast}
            </button>
          )}
        </div>
      ) : (
        areas.map(([area, list]) => (
          <section key={area} aria-label={area}>
            <h2 className="border-b border-border-light pb-1.5 text-sm font-semibold">{area}</h2>
            <ul>
              {list.map(rule => (
                <li
                  key={rule.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 border-b border-border-light py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                >
                  <p
                    className={[
                      "text-base leading-6",
                      rule.active ? "" : "text-typography-400 line-through",
                    ].join(" ")}
                  >
                    {rule.statement}
                  </p>
                  <span className="whitespace-nowrap text-xs font-semibold tracking-wide">
                    {rule.effect === "decide" ? strings.decideForMe : ""}
                    {!rule.active ? ` ${strings.off}` : ""}
                  </span>
                  <span className="relative col-span-full flex items-center gap-2 whitespace-nowrap text-xs text-typography-500 sm:col-span-1">
                    {rule.appliedCount ? (
                      <button
                        type="button"
                        className="underline underline-offset-2"
                        onClick={() => onHistory(rule)}
                      >
                        {strings.applied(rule.appliedCount)}
                      </button>
                    ) : (
                      strings.applied(0)
                    )}
                    {rule.lastAppliedAt && <span>· {relative(rule.lastAppliedAt)}</span>}
                    <button
                      type="button"
                      aria-label={strings.actions}
                      aria-haspopup="menu"
                      aria-expanded={menu === rule.id}
                      className="inline-flex h-10 w-10 items-center justify-center hover:bg-neutral-100"
                      onClick={() => setMenu(menu === rule.id ? null : rule.id)}
                    >
                      <ThreeDot className="h-4 w-4" aria-hidden />
                    </button>
                    {menu === rule.id && (
                      <span
                        role="menu"
                        className="absolute right-0 top-10 z-20 flex min-w-[160px] flex-col border border-border-light bg-white text-sm text-typography-900 shadow"
                      >
                        <button
                          role="menuitem"
                          type="button"
                          className="px-4 py-2.5 text-left hover:bg-neutral-100"
                          onClick={() => {
                            setMenu(null);
                            onEdit(rule);
                          }}
                        >
                          {strings.edit}
                        </button>
                        <button
                          role="menuitem"
                          type="button"
                          className="px-4 py-2.5 text-left hover:bg-neutral-100"
                          onClick={() => toggle(rule)}
                        >
                          {rule.active ? strings.turnOff : strings.turnOn}
                        </button>
                        <button
                          role="menuitem"
                          type="button"
                          className="px-4 py-2.5 text-left hover:bg-neutral-100"
                          onClick={() => {
                            setMenu(null);
                            onHistory(rule);
                          }}
                        >
                          {strings.history}
                        </button>
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
};
