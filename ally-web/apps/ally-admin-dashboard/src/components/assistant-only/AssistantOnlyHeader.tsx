import React from "react";

import { Link, useLocation } from "react-router-dom";

import { useGetMyPlanQuery } from "@api";
import { ROUTES, en } from "@constants";
import { useUser } from "@hooks";

import { PLAN } from "../../pages/Plan/copy";

const linkClass =
  "inline-flex h-11 items-center rounded-md px-3 text-sm font-medium text-typography-800 hover:bg-background-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500";

/**
 * "Plan and usage" for someone with no Sidebar, so no account menu to find it in: their plan in
 * one line (written by ally-be, never dollars) and the way to the page. Same rule as the account
 * menu's item: only for someone with a plan (a chatbot creator).
 */
const PlanLink: React.FC = () => {
  const { data } = useGetMyPlanQuery();
  if (!data?.isCreator) return null;
  return (
    <>
      {data.plan?.line && (
        <span
          className="ally-small text-typography-600 max-md:hidden"
          data-testid="assistant-only-plan-line"
        >
          {data.plan.line}
        </span>
      )}
      <Link to={ROUTES.MY_PLAN} className={linkClass} data-testid="assistant-only-plan">
        {PLAN.menuItem}
      </Link>
    </>
  );
};

/**
 * The frame around the assistants area, which has no Sidebar for anyone. For someone whose way in
 * is an assistant's team (chunk 6b, item 31) it is all there is: who they are, their Plan and
 * usage, and Log out. Someone with other Ally admin pages also gets the way back to them
 * (`adminHome`). The assistant switcher is in each assistant's own header, beside its name.
 */
export const AssistantOnlyHeader: React.FC<{ adminHome?: string | null }> = ({ adminHome }) => {
  const { user, logout } = useUser();
  const { pathname } = useLocation();
  const name = user?.email ?? "";
  const onPlan = pathname === ROUTES.MY_PLAN;
  return (
    <header
      data-testid="assistant-only-header"
      className="flex h-12 shrink-0 items-center justify-end gap-3 border-b border-border-light bg-white px-4"
    >
      {adminHome && (
        <Link to={adminHome} className={`${linkClass} mr-auto`} data-testid="assistants-to-admin">
          {en.assistantsShell.toAllyAdmin}
        </Link>
      )}
      {onPlan ? (
        <Link
          to={ROUTES.WHATSAPP_BOT}
          className={`${linkClass} mr-auto`}
          data-testid="assistant-only-back"
        >
          {en.assistantsShell.toYourAssistants}
        </Link>
      ) : (
        <PlanLink />
      )}
      {name && <span className="ally-small text-typography-600 max-md:hidden">{name}</span>}
      <button
        type="button"
        onClick={() => logout()}
        data-testid="assistant-only-logout"
        className={linkClass}
      >
        {en.assistantsShell.logOut}
      </button>
    </header>
  );
};
