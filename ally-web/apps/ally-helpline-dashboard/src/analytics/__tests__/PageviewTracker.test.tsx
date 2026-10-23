import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const capturePageview = vi.fn();
vi.mock("@hooks/useAnalytics", () => ({
  useAnalytics: () => ({ capturePageview }),
}));

import { PageviewTracker } from "../index";

/**
 * Not mocked on purpose. RouteLayout's test mocks the tracker away "to avoid
 * context error", and that is how helpline-v1.50.3 shipped a tracker that
 * crashed the whole app: the shared one read react-router-dom 7's context
 * inside this app's react-router-dom 6 router. Rendering the real export
 * inside this app's own router is the check that would have failed.
 */
describe("PageviewTracker (helpline)", () => {
  it("renders inside the app's own router and records the page", () => {
    expect(() =>
      render(
        <MemoryRouter initialEntries={["/home?tab=1"]}>
          <PageviewTracker />
        </MemoryRouter>,
      ),
    ).not.toThrow();
    expect(capturePageview).toHaveBeenCalledWith("/home?tab=1");
  });
});
