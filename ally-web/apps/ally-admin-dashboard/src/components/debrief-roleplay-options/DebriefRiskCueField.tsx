import React, { useMemo, useState } from "react";

import { CarbonDropdown, Tooltip } from "@ally-ui-mono/ui-shared";
import { useGetRiskCueOptionsQuery } from "@api";
import { TooltipIcon } from "@assets";
import { en } from "@constants";
import { RiskCueOption } from "@types";

import { RiskCueDialog } from "./RiskCueDialog";
import { useDebriefOptionsVisible } from "./useDebriefOptionsVisible";

const STANDARD_KEY = "standard";

interface Item {
  option: RiskCueOption;
  label: string;
  disabled?: boolean;
}

const isStandard = (o: RiskCueOption) => o.key === STANDARD_KEY;

/** What the form holds for an option: Standard is null, the rest their key. */
export const riskCueValue = (o: RiskCueOption): string | null => (isStandard(o) ? null : o.key);

/**
 * The options the dropdown lists, Standard first. Only approved ones can be picked; the writer's
 * own drafts and waiting options show disabled with their status in words. The saved choice always
 * stays in the list, so a roleplay never shows an empty box over a choice it still has.
 */
export const riskCueItems = (options: RiskCueOption[], savedKey: string | null): Item[] => {
  const s = en.debriefRoleplayOptions;
  const items: Item[] = [];
  for (const option of options) {
    const approved = option.status === "approved";
    const pending =
      option.mine && (option.status === "draft" || option.status === "awaiting_approval");
    const saved = option.key === savedKey;
    if (!approved && !pending && !saved) continue;
    items.push({
      option,
      label: approved
        ? option.name
        : `${option.name} — ${s.status[option.status] ?? option.status}`,
      disabled: approved ? undefined : true,
    });
  }
  return items.sort((a, b) => Number(isStandard(b.option)) - Number(isStandard(a.option)));
};

/**
 * Simulation editor › how the debrief treats risk cues in this roleplay. Reads and writes the form
 * value `debriefRiskCueOption` (saved on the scenario; null = Standard). Also where an author
 * writes a new option and opens one of their own drafts.
 */
export const DebriefRiskCueField: React.FC<{
  id?: string;
  formMethods: any;
  readOnly?: boolean;
}> = ({ id = "debriefRiskCueOption", formMethods, readOnly }) => {
  const s = en.debriefRoleplayOptions;
  const visible = useDebriefOptionsVisible(formMethods);
  const q = useGetRiskCueOptionsQuery(undefined, { skip: !visible });
  const [dialog, setDialog] = useState<{ open: boolean; optionId: string | null }>({
    open: false,
    optionId: null,
  });
  const value = (formMethods?.watch(id) as string | null | undefined) || null;
  const items = useMemo(() => riskCueItems(q.data ?? [], value), [q.data, value]);
  const selected = items.find(i => riskCueValue(i.option) === value) ?? null;
  const mine = (q.data ?? []).filter(
    o => o.mine && (o.status === "draft" || o.status === "awaiting_approval"),
  );
  if (!visible) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="debrief-risk-cue-field">
      <label htmlFor={id} className="flex items-center gap-1 text-base text-typography-900">
        {s.riskCueLabel}
        <Tooltip label={s.riskCueTip} align="top">
          <button type="button" className="inline-flex cursor-pointer items-center">
            <TooltipIcon />
          </button>
        </Tooltip>
      </label>
      {q.isLoading ? (
        <span className="text-sm text-typography-500">{s.loading}</span>
      ) : q.isError ? (
        <span className="text-sm text-typography-500">{s.loadFailed}</span>
      ) : (
        <CarbonDropdown
          id={id}
          titleText=""
          hideLabel
          label={s.riskCueLabel}
          items={items}
          selectedItem={selected}
          itemToString={(i: Item | null) => i?.label ?? ""}
          disabled={readOnly}
          onChange={({ selectedItem }: { selectedItem: Item | null }) => {
            if (selectedItem && !selectedItem.disabled)
              formMethods.setValue(id, riskCueValue(selectedItem.option), { shouldDirty: true });
          }}
        />
      )}
      {selected?.option.description && (
        <p className="truncate text-[13px] text-typography-600" title={selected.option.description}>
          {selected.option.description}
        </p>
      )}
      {!readOnly && (
        <div className="flex flex-col gap-1">
          {mine.map(o => (
            <div
              key={o.id}
              className="flex flex-nowrap items-center justify-between gap-2 text-sm"
              data-testid={`risk-cue-mine-${o.key}`}
            >
              <span className="truncate" title={o.name}>
                {o.name} — {s.status[o.status]}
              </span>
              <button
                type="button"
                className="shrink-0 text-primary-500 underline"
                onClick={() => setDialog({ open: true, optionId: o.id })}
              >
                {s.editLink}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="self-start text-sm text-primary-500 underline"
            onClick={() => setDialog({ open: true, optionId: null })}
          >
            {s.createLink}
          </button>
        </div>
      )}
      {dialog.open && (
        <RiskCueDialog
          optionId={dialog.optionId}
          onClose={() => setDialog({ open: false, optionId: null })}
        />
      )}
    </div>
  );
};
