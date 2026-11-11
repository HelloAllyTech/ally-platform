import { StrictMode } from "react";

import { GoogleOAuthProvider } from "@react-oauth/google";
import * as ReactDOM from "react-dom/client";
import { Provider } from "react-redux";

import { initAnalytics, AnalyticsProvider } from "@ally-ui-mono/ui-shared";

import App from "./App";
import { initColorMode } from "./hooks/useColorMode";
import { store } from "./store";
// Tailwind + global serif base rules first, then the Carbon design-language
// layer (tokens + component styles) so it cascades on top of Tailwind's reset.
import "./styles.css";
import "@ally-ui-mono/ui-shared/styles/carbon-serif.scss";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

const GOOGLE_AUTH_CLIENT_ID = import.meta.env.VITE_GOOGLE_AUTH_CLIENT_ID || "";

initAnalytics();
initColorMode();

// Every deploy replaces the hashed chunk files, so a tab opened before the
// deploy fails to lazy-load its next screen (a white page). Vite signals this
// as vite:preloadError; reload once to pick up the fresh index. The session
// flag stops a reload loop if the failure is something other than staleness.
window.addEventListener("vite:preloadError", event => {
  const RELOADED_KEY = "adminPreloadErrorReloadedAt";
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOADED_KEY) ?? 0);
  } catch {
    // sessionStorage unavailable (private mode edge cases) - fall through.
  }
  if (Date.now() - last > 60_000) {
    event.preventDefault();
    try {
      sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
    } catch {
      // Best effort - a reload loop guard, not critical state.
    }
    window.location.reload();
  }
});

const AppWithProviders = GOOGLE_AUTH_CLIENT_ID ? (
  <GoogleOAuthProvider clientId={GOOGLE_AUTH_CLIENT_ID}>
    <App />
  </GoogleOAuthProvider>
) : (
  <App />
);

root.render(
  <StrictMode>
    <Provider store={store}>
      <AnalyticsProvider>{AppWithProviders}</AnalyticsProvider>
    </Provider>
  </StrictMode>,
);
