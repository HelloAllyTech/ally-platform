import React, { Suspense, useEffect, useState } from "react";

import { Menu } from "@icons";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { InlineLoading } from "@ally-ui-mono/ui-shared";
// Direct paths, not the @components barrel: suites mock these two on their own.
import { CommandPaletteProvider } from "@components/command-palette/CommandPaletteProvider";
import { ErrorBoundary } from "@components/error-boundary";
import { NotificationBell } from "@components/notification-bell/NotificationBell";
import ReportUploadProgressDialog from "@components/report-upload-progress-dialog/ReportUploadProgressDialog";
import { ScenarioReportsSocketProvider } from "@components/scenario-reports-socket-provider/ScenarioReportsSocketProvider";
import { Sidebar } from "@components/sidebar";
import { LOCAL_STORAGE_KEYS, ROUTES, en } from "@constants";
import { UploadDockHost } from "@pages/ContextLibrary/upload/UploadDock";

import { PageBreadcrumbs } from "./PageBreadcrumbs";
import { resolveRouteMeta } from "./routeMeta";
import { ShellContext } from "./ShellContext";
import { useDocumentTitle } from "./useDocumentTitle";

/** What a lazy page shows while its chunk loads, inside the shell (the sidebar never blinks). */
export const PageFallback: React.FC = () => (
  <div
    className="flex h-full min-h-[300px] items-center justify-center"
    data-testid="page-loading"
    role="status"
  >
    <InlineLoading description={en.nav.pageLoading} />
  </div>
);

/**
 * The one layout route every signed-in admin page renders inside. The sidebar, command palette,
 * mobile drawer and scroll area are mounted once here, so their state (a folded section, the
 * sidebar's pinned/hover state, a half-typed menu search) survives navigation instead of being
 * rebuilt per page. Each page's own `PrivateLayout` below only decides access.
 */
export const AdminShell: React.FC = () => {
  const isAuthenticated =
    localStorage.getItem(LOCAL_STORAGE_KEYS.ADMIN_IS_AUTHENTICATED) === "true";
  const { pathname, search } = useLocation();
  const meta = resolveRouteMeta(pathname, search);
  // A URL the table does not know is either a redirect (no title to set) or the 404, which sets its own.
  useDocumentTitle(meta.known ? meta.title : undefined, meta.known);

  // Phone-only nav drawer (the Sidebar is an in-flow rail from md up). It covers the page, so any
  // navigation and Escape close it.
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!isMobileNavOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMobileNavOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isMobileNavOpen]);

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.LOGIN} replace />;
  }

  return (
    <ShellContext.Provider value>
      <ScenarioReportsSocketProvider>
        <CommandPaletteProvider>
          <div className="flex h-dvh bg-white">
            <a
              href="#admin-main-content"
              className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[1001] focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow"
            >
              {en.nav.skipToContent}
            </a>
            <Sidebar
              isMobileOpen={isMobileNavOpen}
              onMobileClose={() => setIsMobileNavOpen(false)}
            />
            {/* Single scroll container for the whole app shell: main never scrolls, the padded
                wrapper is the one scroll area. A page that sets its own overflow fills the wrapper
                exactly; a tall page with no own overflow scrolls the wrapper — one scrollbar either
                way. `relative` makes it the containing block for absolutely-positioned
                descendants (Carbon's `cds--visually-hidden` labels would otherwise stretch the
                page's scroll height). */}
            <main
              id="admin-main-content"
              tabIndex={-1}
              className="flex min-w-0 flex-1 flex-col overflow-hidden outline-none"
            >
              {/* Phone only: the menu button is the one way into navigation there. */}
              <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border-light bg-white px-2 md:hidden">
                <button
                  type="button"
                  onClick={() => setIsMobileNavOpen(true)}
                  aria-label={en.common.openMenu}
                  aria-expanded={isMobileNavOpen}
                  aria-controls="admin-nav-sidebar"
                  data-testid="admin-mobile-menu-button"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-background-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
                >
                  <Menu size={24} aria-hidden="true" />
                </button>
                <div className="ml-auto">
                  <NotificationBell placement="below" />
                </div>
              </div>
              {/* Full-bleed pages draw their own frame to the edges, so no trail above them. */}
              {meta.known && !meta.fullBleed && <PageBreadcrumbs crumbs={meta.crumbs} />}
              <div
                className={`relative min-h-0 flex-1 overflow-y-auto ${meta.fullBleed ? "" : "p-4 lg:p-6"}`}
              >
                {/* The barrier sits inside the shell, not around it: a page that throws should
                    cost the admin that page, not the sidebar and their way out of it. */}
                <ErrorBoundary resetKey={pathname}>
                  <Suspense fallback={<PageFallback />}>
                    <Outlet />
                  </Suspense>
                </ErrorBoundary>
              </div>
            </main>
            <ReportUploadProgressDialog />
            {/* Context Library's upload dock: draws nothing until documents are added, then keeps
                following them on every admin page. */}
            <UploadDockHost />
          </div>
        </CommandPaletteProvider>
      </ScenarioReportsSocketProvider>
    </ShellContext.Provider>
  );
};
