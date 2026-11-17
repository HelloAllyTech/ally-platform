import React, { useMemo } from "react";

import { CarbonDropdown, Tooltip } from "@ally-ui-mono/ui-shared";
import { useGetDebriefSkillFrameworksQuery } from "@api";
import { TooltipIcon } from "@assets";
import { en } from "@constants";
import { DebriefSkillFrameworkOption } from "@types";

import { useDebriefOptionsVisible } from "./useDebriefOptionsVisible";

const NONE_ID = "none";

interface Item {
  option: DebriefSkillFrameworkOption;
  label: string;
}

/** The default first, "None" last, the rest between. */
export const orderFrameworks = (
  options: DebriefSkillFrameworkOption[],
): DebriefSkillFrameworkOption[] => {
  const rank = (o: DebriefSkillFrameworkOption) => (o.isDefault ? 0 : o.id === NONE_ID ? 2 : 1);
  return [...options].sort((a, b) => rank(a) - rank(b));
};

/** What the form holds for an option: the default is null, "None" is "none", the rest their id. */
export const frameworkValue = (o: DebriefSkillFrameworkOption): string | null =>
  o.isDefault ? null : o.id;

/**
 * Simulation editor › the roleplay's skill framework for its debrief. Reads and writes the form
 * value `debriefSkillFramework` (saved on the scenario; null = the default).
 */
export const DebriefSkillFrameworkField: React.FC<{
  id?: string;
  formMethods: any;
  readOnly?: boolean;
}> = ({ id = "debriefSkillFramework", formMethods, readOnly }) => {
  const s = en.debriefRoleplayOptions;
  const visible = useDebriefOptionsVisible(formMethods);
  const q = useGetDebriefSkillFrameworksQuery(undefined, { skip: !visible });
  const value = (formMethods?.watch(id) as string | null | undefined) ?? null;
  const items: Item[] = useMemo(
    () =>
      orderFrameworks(q.data ?? []).map(option => ({
        option,
        label: option.isDefault
          ? `${option.name}${s.defaultSuffix}`
          : option.id === NONE_ID
            ? s.none
            : option.name,
      })),
    [q.data, s.defaultSuffix, s.none],
  );
  const selected = items.find(i => frameworkValue(i.option) === (value || null)) ?? null;
  if (!visible) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="debrief-framework-field">
      <label htmlFor={id} className="flex items-center gap-1 text-base text-typography-900">
        {s.frameworkLabel}
        <Tooltip label={s.frameworkTip} align="top">
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
          label={s.frameworkLabel}
          items={items}
          selectedItem={selected}
          itemToString={(i: Item | null) => i?.label ?? ""}
          disabled={readOnly}
          onChange={({ selectedItem }: { selectedItem: Item | null }) => {
            if (selectedItem)
              formMethods.setValue(id, frameworkValue(selectedItem.option), { shouldDirty: true });
          }}
        />
      )}
    </div>
  );
};
