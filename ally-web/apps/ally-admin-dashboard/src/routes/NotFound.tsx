import React from "react";

import { Link } from "react-router-dom";

import { en } from "@constants";

import { useDocumentTitle } from "./useDocumentTitle";

/** An unknown URL under the admin shell: say so and offer the way home, rather than redirecting silently. */
export const NotFound: React.FC = () => {
  useDocumentTitle(en.nav.pages.notFound);
  return (
    <div
      role="alert"
      data-testid="admin-not-found"
      className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center font-primary"
    >
      <h1 className="text-2xl font-medium text-typography-900">{en.nav.notFound.title}</h1>
      <p className="text-base text-typography-700">{en.nav.notFound.body}</p>
      {/* "/" lands on the admin's first visible page. */}
      <Link
        to="/"
        className="inline-flex items-center rounded-lg bg-primary-500 px-6 py-3 text-base font-medium text-white shadow-sm transition-colors hover:bg-primary-600"
      >
        {en.nav.notFound.home}
      </Link>
    </div>
  );
};
