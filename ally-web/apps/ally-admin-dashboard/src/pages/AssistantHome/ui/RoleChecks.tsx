import React from "react";

import { Input } from "@components/input";
import { ChatbotMemberRole } from "@types";

import { ROLE_ORDER, sortRoles } from "../access";
import { PEOPLE } from "../copy/people";

/**
 * The four roles as checkboxes: any mix, never none. Unchecking the last one changes nothing and
 * calls `onLast` so the caller can say why.
 */
export const RoleChecks: React.FC<{
  legend: string;
  value: ChatbotMemberRole[];
  onChange: (next: ChatbotMemberRole[]) => void;
  onLast?: () => void;
  disabled?: boolean;
  showHelp?: boolean;
}> = ({ legend, value, onChange, onLast, disabled, showHelp }) => (
  <fieldset className="ally-role-checks" disabled={disabled}>
    <legend className="ally-sr-only">{legend}</legend>
    {ROLE_ORDER.map(role => {
      const checked = value.includes(role);
      return (
        <label key={role} className="ally-role-checks__item">
          <Input
            className="!h-4 !w-4"
            type="checkbox"
            checked={checked}
            onChange={() => {
              if (checked && value.length === 1) {
                onLast?.();
                return;
              }
              onChange(sortRoles(checked ? value.filter(r => r !== role) : [...value, role]));
            }}
          />
          <span>
            {PEOPLE.roles[role]}
            {showHelp && <small className="ally-small"> {PEOPLE.roleHelp[role]}</small>}
          </span>
        </label>
      );
    })}
  </fieldset>
);
