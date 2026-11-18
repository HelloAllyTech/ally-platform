import React, { useEffect, useState } from "react";

import { toast } from "sonner";

import { RadioButton, RadioButtonGroup } from "@ally-ui-mono/ui-shared";
import { useSetRoadmapRoleForMutation } from "@api";
import { FeatureToggleKey, en } from "@constants";
import type { RoadmapGrantableRole, RoadmapRoleEntry } from "@types";

export const ROADMAP_ROLE_OPTIONS: RoadmapGrantableRole[] = ["none", "idea", "builder", "owner"];

/**
 * The three toggles the radio writes together (§3.2). While the radio shows, the Users screen hides
 * them from its toggle list, so nobody can set Owner without Builder by hand.
 */
export const ROADMAP_ROLE_TOGGLE_KEYS: string[] = [
  FeatureToggleKey.PRODUCT_ROADMAP,
  FeatureToggleKey.BUILDER,
  FeatureToggleKey.PRODUCT_ROADMAP_MANAGE,
];

interface RoadmapRoleRadioProps {
  entry: RoadmapRoleEntry;
  /** The signed-in Owner can't change their own role (the server answers 400), so the last Owner stays. */
  isSelf: boolean;
}

/**
 * Users screen → one "Roadmap role" radio: None · Idea · Builder · Owner (§3.2). PUT
 * `/v1/roadmap/roles/:userId` writes product_roadmap, builder and product_roadmap_manage in one go
 * and busts that person's permission cache, so it applies at once. Optimistic, with rollback.
 */
export const RoadmapRoleRadio: React.FC<RoadmapRoleRadioProps> = ({ entry, isSelf }) => {
  const copy = en.roadmapV2Tools.roles;
  const [setRole, { isLoading }] = useSetRoadmapRoleForMutation();
  const [value, setValue] = useState<RoadmapGrantableRole>(entry.setting);
  useEffect(() => setValue(entry.setting), [entry.setting]);

  const choose = async (next: RoadmapGrantableRole) => {
    if (next === value || isSelf) return;
    const previous = value;
    setValue(next);
    try {
      await setRole({ userId: entry.userId, role: next }).unwrap();
      toast.success(copy.saved(entry.name, copy.options[next]));
    } catch (error) {
      setValue(previous);
      const message = (error as { data?: { message?: unknown } })?.data?.message;
      toast.error(typeof message === "string" && message ? message : copy.failed);
    }
  };

  return (
    <section className="flex flex-col gap-1" data-testid="admin-roadmap-role">
      <h3 className="mb-2 font-secondary text-base text-typography-900">{copy.title}</h3>
      <p className="m-0 mb-2 text-sm text-typography-600">{copy.help}</p>
      <RadioButtonGroup
        legendText={copy.title}
        name={`roadmap-role-${entry.userId}`}
        orientation="vertical"
        valueSelected={value}
        disabled={isSelf || isLoading}
        onChange={(next: string | number | undefined) => void choose(next as RoadmapGrantableRole)}
      >
        {ROADMAP_ROLE_OPTIONS.map(option => {
          const id = `roadmap-role-${entry.userId}-${option}`;
          return (
            <RadioButton
              key={option}
              id={id}
              value={option}
              labelText={
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm text-typography-900">{copy.options[option]}</span>
                  <span className="text-sm text-typography-600">{copy.optionHelp[option]}</span>
                </span>
              }
            />
          );
        })}
      </RadioButtonGroup>
      {entry.restricted && (
        <p className="m-0 mt-1 text-sm text-typography-800">{copy.restricted}</p>
      )}
      {isSelf && <p className="m-0 mt-1 text-sm text-typography-600">{copy.yourself}</p>}
    </section>
  );
};
