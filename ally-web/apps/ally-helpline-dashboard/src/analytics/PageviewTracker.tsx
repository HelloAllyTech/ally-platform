import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { useAnalytics } from "@hooks/useAnalytics";

/**
 * Fires a $pageview PostHog event on every React Router route transition.
 * Renders nothing — mount as a direct child of <BrowserRouter> in RouteLayout.
 *
 * Kept in this app rather than re-exported from ui-shared: this app is on
 * react-router-dom 6 (its own node_modules), while a ui-shared module resolves
 * react-router-dom from the workspace root, which is 7. The shared tracker's
 * useLocation() then reads v7's router context, never finds this app's v6
 * <BrowserRouter>, and throws "useLocation() may be used only in the context of
 * a <Router> component" — which took the whole app down in helpline-v1.50.3.
 */
export function PageviewTracker() {
  const location = useLocation();
  const { capturePageview } = useAnalytics();

  useEffect(() => {
    capturePageview(location.pathname + location.search);
  }, [location.pathname, location.search, capturePageview]);

  return null;
}
