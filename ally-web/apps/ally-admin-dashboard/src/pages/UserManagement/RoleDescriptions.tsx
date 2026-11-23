import React from "react";

import { en, userRoleItems } from "@constants";

/** One line per assignable role, so the picker is not a list of bare codes. */
export const RoleDescriptions: React.FC = () => (
  <div className="text-sm text-typography-700 bg-background-secondary p-3 rounded-lg border border-border-light">
    <p className="font-medium mb-1">{en.userManagement.roleHelpHeading}</p>
    <ul className="list-disc pl-5 space-y-1">
      {userRoleItems
        .filter(role => en.userManagement.roleHelp[role])
        .map(role => (
          <li key={role}>{en.userManagement.roleHelp[role]}</li>
        ))}
    </ul>
  </div>
);
