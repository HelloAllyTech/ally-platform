import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { store } from "@store";

import {
  forgetMissingLandingPages,
  LandingPublicPage,
} from "../../pages/landing-public/LandingPublicPage";

/**
 * Regression: `/:tenantCode/:slug/*` outranks the root `/*` for any address of two or
 * more parts, so the signed-in app is rendered as the landing page's fallback. Its own
 * <Routes> must still match the whole address. They used to match only the part after
 * the first two segments, so /simulation/<id>/<title> fell to the catch-all and every
 * web roleplay bounced back to Learn without connecting.
 */
const App = () => (
  <Routes>
    <Route path="/simulation/:id/:scenarioTitle" element={<div>simulation page</div>} />
    <Route path="/simulation-summary/:sessionId" element={<div>summary page</div>} />
    <Route path="*" element={<div>catch-all</div>} />
  </Routes>
);

const renderAt = (path: string) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/:tenantCode/:slug/*" element={<LandingPublicPage fallback={<App />} />} />
          <Route path="/*" element={<App />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );

describe("an app address that the landing-page route also matches", () => {
  beforeEach(() => forgetMissingLandingPages());

  it("opens the roleplay room at /simulation/<id>/<title>", () => {
    renderAt("/simulation/88ad2f98/[Ally Originals] Guide Kavya, in managing peer pressure");
    expect(screen.getByText("simulation page")).toBeInTheDocument();
  });

  it("opens a two-part app address too", () => {
    renderAt("/simulation-summary/88ad2f98");
    expect(screen.getByText("summary page")).toBeInTheDocument();
  });
});
