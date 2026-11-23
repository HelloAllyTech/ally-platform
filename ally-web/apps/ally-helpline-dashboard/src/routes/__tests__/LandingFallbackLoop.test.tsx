import { Suspense } from "react";

import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { store } from "@store";

import { AnalyticsProvider } from "../../analytics";
import i18n from "../../i18n";
import {
  forgetMissingLandingPages,
  LandingPublicPage,
} from "../../pages/landing-public/LandingPublicPage";
import PrivateRouteLayout from "../PrivateRouteLayout";

/**
 * Regression: at a two-part address that is not a landing page, the page hands over to the
 * app's own (private) screen. On first load that screen can suspend, so React throws the
 * half-built tree away and mounts it again; the landing page used to ask the server again on
 * every restart and sent about sixty requests a second until the tab was closed.
 *
 * Uses the real private layout on purpose: a stand-in that suspends does not reproduce it.
 */
describe("a two-part address that is not a landing page", () => {
  beforeEach(() => forgetMissingLandingPages());

  it("asks the server once, however often the app screen restarts", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : "url" in input ? input.url : String(input);
        calls.push(url);
        const isLanding = url.includes("landing-pages");
        return new Response(JSON.stringify({ message: isLanding ? "not found" : "Unauthorized" }), {
          status: isLanding ? 404 : 401,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <AnalyticsProvider>
            <Suspense fallback={null}>
              <MemoryRouter initialEntries={["/loop-tenant/loop-page"]}>
                <Routes>
                  <Route
                    path="/:tenantCode/:slug/*"
                    element={<LandingPublicPage fallback={<PrivateRouteLayout />} />}
                  />
                  <Route path="/login" element={<div>login</div>} />
                </Routes>
              </MemoryRouter>
            </Suspense>
          </AnalyticsProvider>
        </I18nextProvider>
      </Provider>,
    );

    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(calls.filter(url => url.includes("landing-pages")).length).toBeLessThanOrEqual(2);
  });
});
