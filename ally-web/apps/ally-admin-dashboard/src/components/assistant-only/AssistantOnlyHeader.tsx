import React from "react";

import { en } from "@constants";
import { useUser } from "@hooks";

/**
 * The only frame around an assistant for someone whose way in is its team (chunk 6b, item 31): no
 * Sidebar and no other page, just who they are and Log out. The assistant switcher is in each
 * assistant's own header, beside its name.
 */
export const AssistantOnlyHeader: React.FC = () => {
  const { user, logout } = useUser();
  const name = user?.email ?? "";
  return (
    <header
      data-testid="assistant-only-header"
      className="flex h-12 shrink-0 items-center justify-end gap-3 border-b border-border-light bg-white px-4"
    >
      {name && <span className="ally-small text-typography-600">{name}</span>}
      <button
        type="button"
        onClick={() => logout()}
        data-testid="assistant-only-logout"
        className="inline-flex h-11 items-center rounded-md px-3 text-sm font-medium text-typography-800 hover:bg-background-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
      >
        {en.assistantsShell.logOut}
      </button>
    </header>
  );
};
