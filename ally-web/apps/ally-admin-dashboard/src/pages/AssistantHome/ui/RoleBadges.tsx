import React from "react";

import { rolesOfMember } from "../access";
import { PEOPLE } from "../copy/people";

/** A person's roles as a set of small badges, most powerful first. */
export const RoleBadges: React.FC<{ roles?: string[]; role?: string }> = ({ roles, role }) => (
  <span className="ally-role-badges" data-testid="role-badges">
    {rolesOfMember({ roles, role }).map(id => (
      <span key={id} className="ally-badge ally-badge--muted">
        {PEOPLE.roles[id]}
      </span>
    ))}
  </span>
);
