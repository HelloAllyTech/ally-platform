import React from "react";

import { Link } from "react-router-dom";

import { en } from "@constants";

import type { Crumb } from "./routeMeta";

/** A slim "Section › Page › Detail" trail above the page. The last crumb is the current page. */
export const PageBreadcrumbs: React.FC<{ crumbs: Crumb[] }> = ({ crumbs }) => {
  if (crumbs.length === 0) return null;
  return (
    <nav
      aria-label={en.nav.breadcrumbLabel}
      data-testid="admin-breadcrumbs"
      className="shrink-0 border-b border-border-light bg-white px-4 py-2 font-primary text-sm text-typography-600 lg:px-6"
    >
      <ol className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <li key={`${index}-${crumb.label}`} className="flex items-center gap-1.5">
              {index > 0 && <span aria-hidden="true">›</span>}
              {crumb.to && !isLast ? (
                <Link to={crumb.to} className="hover:text-typography-900 hover:underline">
                  {crumb.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={isLast ? "font-medium text-typography-900" : undefined}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
