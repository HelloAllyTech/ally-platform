import React from "react";

import { Link } from "react-router-dom";

import { ROUTES } from "@constants";
import { useUser } from "@hooks";

import { DIR } from "./copy";

const linkClass =
  "inline-flex h-11 items-center rounded-md px-3 text-sm font-medium text-typography-800 hover:bg-background-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500";

/** The frame around the directory, which has no side navigation: the product name and who is signed in. */
export const DirectoryHeader: React.FC = () => {
  const { user, logout } = useUser();
  return (
    <header
      data-testid="directory-header"
      className="flex h-12 shrink-0 items-center gap-3 border-b border-border-light bg-white px-4"
    >
      <Link
        to={ROUTES.DIRECTORY}
        className="flex items-center gap-2 font-secondary text-lg font-semibold tracking-[-0.03em]"
      >
        <span>{DIR.wordmarkName}</span>
        <span className="bg-[#0F766E] px-2 pb-0.5 leading-tight text-[#FFFFFF]">{DIR.product}</span>
      </Link>
      <span className="ml-auto ally-small text-typography-600 max-md:hidden">
        {user?.email ?? ""}
      </span>
      <button
        type="button"
        onClick={() => logout()}
        data-testid="directory-logout"
        className={linkClass}
      >
        {DIR.logOut}
      </button>
    </header>
  );
};
