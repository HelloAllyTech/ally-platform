import React, { useMemo, useState } from "react";

import { toast } from "sonner";

import { Button, Select, SelectItem, Tag } from "@ally-ui-mono/ui-shared";
import { useGetRoadmapProductGoalsQuery, usePatchRoadmapItemMutation } from "@api";
import { en } from "@constants";
import type { RoadmapItemDetail, RoadmapItemPatch } from "@types";

import { useRoadmapBreakpoint } from "../hooks/useRoadmapBreakpoint";
import { LeadPicker } from "../triage/LeadPicker";
import { useReviewActions } from "../triage/useReviewActions";

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

/** A Carbon Select with its label beside it (inline), at the small size the banner uses. */
const SelectField: React.FC<{
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}> = ({ id, label, value, options, disabled, onChange }) => (
  <Select
    id={id}
    inline
    size="sm"
    labelText={label}
    value={value}
    disabled={disabled}
    onChange={(event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
    className="!w-auto"
  >
    {options.map(option => (
      <SelectItem key={option.value} value={option.value} text={option.label} />
    ))}
  </Select>
);

/** A fact you can read but not change: a Carbon Tag, "Goal: Actor realism". */
const ReadField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <Tag type="gray" size="md" className="!m-0 max-w-full">
    {label}: {children}
  </Tag>
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
          id={`${item.code}-goal`}
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
          <Button
            kind="tertiary"
            size="sm"
            onClick={() => setLeadOpen(true)}
            aria-label={item.lead ? banner.changeLead(item.lead.name) : undefined}
          >
            {banner.lead}: {item.lead?.name ?? banner.leadNone}
          </Button>
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
          id={`${item.code}-month`}
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
