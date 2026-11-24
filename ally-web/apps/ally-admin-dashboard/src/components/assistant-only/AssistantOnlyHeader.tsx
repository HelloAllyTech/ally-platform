import React, { useEffect, useId, useRef, useState } from "react";

import { Link, useLocation } from "react-router-dom";

import { useGetFeatureTogglesQuery, useGetMyPlanQuery } from "@api";
import { FeatureToggleKey, ROUTES, en } from "@constants";
import { useUser } from "@hooks";
import { hasFeature } from "@utils/permissions";

const linkClass =
  "inline-flex h-11 items-center rounded-md px-3 text-sm font-medium text-typography-800 hover:bg-background-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500";

const t = en.assistantsShell.cornerMenu;

/**
 * The one corner menu (stage 2): Plan and credits, who is signed in, and Log out. Replaces the
 * separate plan line, Plan link, email and Log out button the header used to lay out in a row.
 * "Plan and credits" goes to the Credits page, for every chatbot builder: a creator (someone who
 * created an assistant, or a custom login with Chatbots on) or anyone with the Assistants switch.
 * A team member who builds nothing sees no link. Escape or a click outside closes it.
 */
const CornerMenu: React.FC = () => {
  const { user, logout } = useUser();
  const { data: plan } = useGetMyPlanQuery();
  const { data: features } = useGetFeatureTogglesQuery();
  const builder = Boolean(plan?.isCreator) || hasFeature(features, FeatureToggleKey.WHATSAPP_BOT);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const email = user?.email ?? "";

  useEffect(() => {
    if (!open) return undefined;
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className={linkClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t.label}
        data-testid="corner-menu-button"
        onClick={() => setOpen(o => !o)}
      >
        <span className="max-w-[200px] truncate">{email || t.label}</span>
        <span aria-hidden="true" className="ml-1">
          ▾
        </span>
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          aria-label={t.label}
          data-testid="corner-menu"
          className="absolute right-0 top-full z-50 mt-1 flex min-w-[220px] flex-col rounded-md border border-border-light bg-white p-1 shadow-lg"
        >
          {email && (
            <p className="px-3 py-2 text-xs text-typography-600" data-testid="corner-menu-profile">
              {t.signedInAs} <span className="font-medium text-typography-800">{email}</span>
            </p>
          )}
          {builder && (
            <>
              {plan?.plan?.line && (
                <p
                  className="px-3 pb-1 text-xs text-typography-600"
                  data-testid="assistant-only-plan-line"
                >
                  {plan.plan.line}
                </p>
              )}
              <Link
                role="menuitem"
                to={ROUTES.MY_CREDITS}
                className={linkClass}
                data-testid="assistant-only-plan"
                onClick={() => setOpen(false)}
              >
                {t.planAndCredits}
              </Link>
            </>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => logout()}
            data-testid="assistant-only-logout"
            className={`${linkClass} w-full text-left`}
          >
            {en.assistantsShell.logOut}
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * The frame around the assistants area, which has no Sidebar for anyone. For someone whose way in
 * is an assistant's team (chunk 6b, item 31) it is all there is: the corner menu. Someone with
 * other Ally admin pages also gets the way back to them (`adminHome`), except while setting up an
 * assistant (one focused flow). The assistant switcher is in each assistant's own header.
 */
export const AssistantOnlyHeader: React.FC<{ adminHome?: string | null }> = ({ adminHome }) => {
  const { pathname } = useLocation();
  const onPlan = pathname === ROUTES.MY_PLAN || pathname === ROUTES.MY_CREDITS;
  // Setting up an assistant is one focused flow: no link out to the rest of Ally admin.
  const settingUp =
    pathname === ROUTES.CHATBOT_NEW || pathname.startsWith(`${ROUTES.CHATBOT_NEW}/`);
  return (
    <header
      data-testid="assistant-only-header"
      className="flex h-12 shrink-0 items-center justify-end gap-3 border-b border-border-light bg-white px-4"
    >
      {adminHome && !settingUp && (
        <Link to={adminHome} className={`${linkClass} mr-auto`} data-testid="assistants-to-admin">
          {en.assistantsShell.toAllyAdmin}
        </Link>
      )}
      {onPlan && (
        <Link
          to={ROUTES.WHATSAPP_BOT}
          className={`${linkClass} mr-auto`}
          data-testid="assistant-only-back"
        >
          {en.assistantsShell.toYourAssistants}
        </Link>
      )}
      <CornerMenu />
    </header>
  );
};
