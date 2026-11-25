import React, { Suspense, lazy, useEffect, useId, useRef, useState } from "react";

import { Link, useLocation, useNavigate } from "react-router-dom";

import { useGetFeatureTogglesQuery, useGetMyPlanQuery } from "@api";
import { Close } from "@assets";
import { FeatureToggleKey, ROUTES, en } from "@constants";
import { useUser } from "@hooks";
import { hasFeature } from "@utils/permissions";

import { AboutPanel } from "./AboutPanel";
import { ASSISTANT_HEADER_SLOT_ID } from "./headerSlot";

import "./corner-drawer.css";

const linkClass =
  "inline-flex h-11 items-center rounded-md px-3 text-sm font-medium text-typography-800 hover:bg-background-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500";

const t = en.assistantsShell.cornerMenu;

// The credits content (and its charts) loads only when the Plan and credits tab is first opened.
const CreditsPanel = lazy(() =>
  import("../../pages/Credits/MyCredits").then(m => ({ default: m.MyCreditsPanel })),
);
const SeatsPanel = lazy(() =>
  import("../../pages/Plan/MyPlan").then(m => ({ default: m.MyPlanPanel })),
);

const ChangeLog = lazy(() => import("./ChangeLogPanel").then(m => ({ default: m.ChangeLogPanel })));

/** About for everyone; the rest are for builders (see the note on `CornerMenu`). */
type DrawerTab = "about" | "credits" | "plan" | "changelog";
const TABS: DrawerTab[] = ["about", "credits", "plan", "changelog"];
const TAB_IDS: Record<DrawerTab, string> = {
  about: "corner-tab-about",
  credits: "corner-tab-credits",
  plan: "corner-tab-plan",
  changelog: "corner-tab-changelog",
};
const TAB_LABELS: Record<DrawerTab, string> = {
  about: t.about,
  credits: t.planAndCredits,
  plan: t.seatsAndPlan,
  changelog: t.changeLog,
};
const PANEL_ID = "corner-tab-panel";

/**
 * The one corner menu (stage 2): a menu icon that opens a settings drawer from the right with two
 * tabs. About: who is signed in, and Log out. Plan and credits: the Credits page's content, drawn
 * in the drawer itself rather than linking out to it. The Plan and credits tab is for every chatbot
 * builder: a creator (someone who created an assistant, or a custom login with Chatbots on) or
 * anyone with the Assistants switch. A team member who builds nothing sees About alone, with no
 * tabs. Escape, the close button or a click on the dimmed page closes it, and focus returns to the
 * menu icon.
 */
const CornerMenu: React.FC = () => {
  const { user, logout } = useUser();
  const { data: plan } = useGetMyPlanQuery();
  const { data: features } = useGetFeatureTogglesQuery();
  const builder = Boolean(plan?.isCreator) || hasFeature(features, FeatureToggleKey.WHATSAPP_BOT);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DrawerTab>("about");
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const email = user?.email ?? "";

  useEffect(() => {
    if (!open) return undefined;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", key);
    closeButton.current?.focus();
    const opener = trigger.current;
    return () => {
      document.removeEventListener("keydown", key);
      opener?.focus();
    };
  }, [open]);

  // Following a link out of the drawer (a chatbot's settings, the plan page) closes it.
  useEffect(() => setOpen(false), [pathname]);

  // Log out clears the session, then lands on /assistants, which shows the sign-in screen to
  // anyone signed out, whichever page the drawer was opened from.
  const signOut = () => {
    setOpen(false);
    logout();
    navigate(ROUTES.WHATSAPP_BOT, { replace: true });
  };

  const activeTab: DrawerTab = builder ? tab : "about";
  const onTabKeyDown = (event: React.KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length];
    setTab(next);
    document.getElementById(TAB_IDS[next])?.focus();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`${linkClass} w-11 justify-center px-0`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={t.label}
        data-testid="corner-menu-button"
        onClick={() => {
          setTab("about");
          setOpen(true);
        }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" data-testid="corner-menu-overlay">
          <div
            className="absolute inset-0 bg-black/30"
            aria-hidden="true"
            data-testid="corner-menu-backdrop"
            onClick={() => setOpen(false)}
          />
          <div
            id={id}
            role="dialog"
            aria-modal="true"
            aria-label={t.label}
            data-testid="corner-menu"
            className="relative flex h-full w-[560px] max-w-full flex-col bg-white shadow-xl"
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border-light pl-4 pr-2">
              <h2
                className="min-w-0 truncate text-base font-normal text-typography-900"
                data-testid="corner-menu-profile"
              >
                {email ? (
                  <>
                    {t.signedInAs} <span className="font-medium">{email}</span>
                  </>
                ) : (
                  t.label
                )}
              </h2>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={signOut}
                  data-testid="assistant-only-logout"
                  className={linkClass}
                >
                  {en.assistantsShell.logOut}
                </button>
                <button
                  ref={closeButton}
                  type="button"
                  className={`${linkClass} w-11 justify-center px-0`}
                  aria-label={t.close}
                  data-testid="corner-menu-close"
                  onClick={() => setOpen(false)}
                >
                  <Close className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            {builder && (
              <div
                role="tablist"
                aria-label={t.tabsLabel}
                className="flex shrink-0 gap-1 border-b border-border-light px-3"
                onKeyDown={onTabKeyDown}
              >
                {TABS.map(id => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    id={TAB_IDS[id]}
                    aria-selected={tab === id}
                    aria-controls={PANEL_ID}
                    tabIndex={tab === id ? 0 : -1}
                    data-testid={`corner-menu-tab-${id}`}
                    onClick={() => setTab(id)}
                    className={`h-11 border-b-2 px-3 text-sm font-medium ${
                      tab === id
                        ? "border-typography-900 text-typography-900"
                        : "border-transparent text-typography-600 hover:text-typography-900"
                    }`}
                  >
                    {TAB_LABELS[id]}
                  </button>
                ))}
              </div>
            )}
            <div
              role={builder ? "tabpanel" : undefined}
              id={PANEL_ID}
              aria-labelledby={builder ? TAB_IDS[activeTab] : undefined}
              className="flex flex-1 flex-col gap-1 overflow-y-auto p-3"
            >
              {activeTab === "about" ? (
                <>
                  {builder && plan?.plan?.line && (
                    <p
                      className="px-3 pb-1 text-xs text-typography-600"
                      data-testid="assistant-only-plan-line"
                    >
                      {plan.plan.line}
                    </p>
                  )}
                  <AboutPanel />
                </>
              ) : (
                <div className="ally-v2 corner-drawer__plan" data-testid="corner-menu-plan">
                  <Suspense fallback={<p className="px-3 py-2 text-sm">{t.loading}</p>}>
                    {activeTab === "credits" ? (
                      <CreditsPanel hidePlanLink />
                    ) : activeTab === "plan" ? (
                      <SeatsPanel />
                    ) : (
                      <ChangeLog />
                    )}
                  </Suspense>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

/**
 * The frame around the assistants area, which has no Sidebar for anyone. For someone whose way in
 * is an assistant's team (chunk 6b, item 31) it is all there is: the corner menu. Someone with
 * other Ally admin pages also gets the way back to them (`adminHome`), except on the chatbots list
 * and while setting up an assistant (one focused flow). The assistant switcher is in each
 * assistant's own header.
 */
export const AssistantOnlyHeader: React.FC<{ adminHome?: string | null }> = ({ adminHome }) => {
  const { pathname } = useLocation();
  const onPlan = pathname === ROUTES.MY_PLAN || pathname === ROUTES.MY_CREDITS;
  // The chatbots list and setting up a chatbot (one focused flow) carry no link out to the rest of
  // Ally admin.
  const noAdminLink =
    pathname === ROUTES.WHATSAPP_BOT ||
    pathname === ROUTES.CHATBOT_NEW ||
    pathname.startsWith(`${ROUTES.CHATBOT_NEW}/`);
  return (
    <header
      data-testid="assistant-only-header"
      className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-end gap-3 border-b border-border-light bg-white px-4"
    >
      {adminHome && !noAdminLink && (
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
      {/* A page's own title and main action (the chatbots list), drawn here by that page. */}
      <div id={ASSISTANT_HEADER_SLOT_ID} className="contents" />
      <CornerMenu />
    </header>
  );
};
