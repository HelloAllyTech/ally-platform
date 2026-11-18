import React, { useMemo, useState } from "react";

import { toast } from "sonner";

import { useGetRoadmapProductGoalsQuery, usePatchRoadmapItemMutation } from "@api";
import { en } from "@constants";
import type { RoadmapItemDetail, RoadmapItemPatch } from "@types";

import { useRoadmapBreakpoint } from "../hooks/useRoadmapBreakpoint";
import { LeadPicker } from "../triage/LeadPicker";
import { useReviewActions } from "../triage/useReviewActions";

const FIELD =
  "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-black/10 bg-white/80 px-3 text-xs text-typography-primary";
const LABEL =
  "shrink-0 text-[11px] font-semibold uppercase tracking-wide text-typography-secondary";

/** 'YYYY-MM' → "Dec 2026". */
export const monthLabel = (value: string): string => {
  const [y, m] = value.split("-").map(Number);
  if (!y || !m) return value;
  return new Date(y, m - 1, 1).toLocaleString("en", { month: "short", year: "numeric" });
};

/** Unscheduled, then this month and the next twelve; a month outside that stays selectable. */
export const monthOptions = (current: string | null | undefined, now = new Date()): string[] => {
  const months = Array.from({ length: 13 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  return current && !months.includes(current) ? [current, ...months] : months;
};

/** A labelled select that looks like a pill; native, so it is reachable and fast everywhere. */
const SelectField: React.FC<{
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}> = ({ label, value, options, disabled, onChange }) => (
  <label className={`${FIELD} cursor-pointer`}>
    <span className={LABEL}>{label}</span>
    <select
      value={value}
      disabled={disabled}
      onChange={event => onChange(event.target.value)}
      className="min-w-0 max-w-[14rem] cursor-pointer truncate border-0 bg-transparent p-0 text-xs font-semibold text-typography-primary outline-none"
    >
      {options.map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </label>
);

/** A labelled value you can read but not change. */
const ReadField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <span className={FIELD}>
    <span className={LABEL}>{label}</span>
    <span className="truncate font-semibold">{children}</span>
  </span>
);

/**
 * What the idea is about, in its banner: Goal, Lead and Planned month, editable by whoever the
 * server says may change them (`can.editGoal` / `editLead` / `editMonth`), plain text for everyone
 * else. Saved the moment a choice is made. Stage is not here: it is worked out from facts and moves
 * with the actions (Pick a lead, Decline, Merge, Release).
 */
export const IdeaBannerControls: React.FC<{ item: RoadmapItemDetail }> = ({ item }) => {
  const copy = en.roadmapV2.actions;
  const banner = copy.banner;
  const [patch, { isLoading }] = usePatchRoadmapItemMutation();
  const { data: goals } = useGetRoadmapProductGoalsQuery(undefined, {
    skip: !item.can?.editGoal,
  });
  const actions = useReviewActions();
  const breakpoint = useRoadmapBreakpoint();
  const [leadOpen, setLeadOpen] = useState(false);

  const save = async (change: RoadmapItemPatch) => {
    try {
      await patch({ code: item.code, patch: change }).unwrap();
    } catch {
      toast.error(copy.editFailed);
    }
  };

  const goalOptions = useMemo(() => {
    const list = (Array.isArray(goals) ? goals : []).map(g => ({ value: g.id, label: g.name }));
    if (item.goal && !list.some(o => o.value === item.goal!.id)) {
      list.unshift({ value: item.goal.id, label: item.goal.name });
    }
    return item.goal ? list : [{ value: "", label: banner.goalNone }, ...list];
  }, [goals, item.goal, banner.goalNone]);

  const month = item.plannedMonth ?? "";
  const monthChoices = useMemo(
    () => [
      { value: "", label: banner.monthNone },
      ...monthOptions(item.plannedMonth).map(v => ({ value: v, label: monthLabel(v) })),
    ],
    [item.plannedMonth, banner.monthNone],
  );

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={en.roadmapV2.idea.panel}>
      {item.can?.editGoal ? (
        <SelectField
          label={banner.goal}
          value={item.goal?.id ?? ""}
          options={goalOptions}
          disabled={isLoading}
          onChange={value => value && void save({ goalId: value })}
        />
      ) : item.goal ? (
        <ReadField label={banner.goal}>{item.goal.name}</ReadField>
      ) : null}

      {item.can?.editLead ? (
        <>
          <button
            type="button"
            onClick={() => setLeadOpen(true)}
            aria-label={item.lead ? banner.changeLead(item.lead.name) : undefined}
            className={`${FIELD} cursor-pointer hover:bg-white`}
          >
            <span className={LABEL}>{banner.lead}</span>
            <span className="truncate font-semibold">{item.lead?.name ?? banner.leadNone} ▾</span>
          </button>
          <LeadPicker
            open={leadOpen}
            code={item.code}
            onClose={() => setLeadOpen(false)}
            onPick={lead => actions.pickLead(item.code, lead)}
            sheet={breakpoint === "phone" || breakpoint === "tablet"}
          />
        </>
      ) : item.lead ? (
        <ReadField label={banner.lead}>{item.lead.name}</ReadField>
      ) : null}

      {item.can?.editMonth ? (
        <SelectField
          label={banner.month}
          value={month}
          options={monthChoices}
          disabled={isLoading}
          onChange={value => void save({ plannedMonth: value || null })}
        />
      ) : item.plannedMonth ? (
        <ReadField label={banner.month}>{monthLabel(item.plannedMonth)}</ReadField>
      ) : null}
    </div>
  );
};
