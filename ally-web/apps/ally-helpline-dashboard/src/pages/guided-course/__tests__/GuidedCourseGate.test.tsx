import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { availability } = vi.hoisted(() => ({ availability: vi.fn() }));

vi.mock("@api", () => ({
  useGetGuideAvailabilityQuery: (args: unknown, options: { skip?: boolean }) =>
    options?.skip ? { isUninitialized: true } : availability(args),
}));

vi.mock("../GuidedCourse", () => ({
  default: ({ trackId }: { trackId: string }) => <div data-testid="guided-course">{trackId}</div>,
}));

import { GuidedCourseGate, isFixtureRequested } from "../GuidedCourseGate";

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/journey/:trackId" element={<GuidedCourseGate />} />
        <Route path="/track/:trackId" element={<div data-testid="classic-course" />} />
        <Route path="/course/:trackId" element={<div data-testid="classic-landing" />} />
        <Route path="/learn" element={<div data-testid="learn" />} />
      </Routes>
    </MemoryRouter>,
  );

describe("GuidedCourseGate", () => {
  beforeEach(() => {
    availability.mockReset();
    localStorage.setItem("accessToken", "token");
  });
  afterEach(() => localStorage.clear());

  it("on: opens the guided journey", async () => {
    availability.mockReturnValue({ data: { guided: true, anonymousChat: false, voice: false } });
    renderAt("/journey/c1");
    expect(await screen.findByTestId("guided-course")).toHaveTextContent("c1");
    expect(availability).toHaveBeenCalledWith({ trackId: "c1" });
  });

  it("off: falls back to the classic course", () => {
    availability.mockReturnValue({ data: { guided: false } });
    renderAt("/journey/c1");
    expect(screen.getByTestId("classic-course")).toBeInTheDocument();
  });

  it("view=classic: goes straight to classic without asking", () => {
    renderAt("/journey/c1?view=classic");
    expect(screen.getByTestId("classic-course")).toBeInTheDocument();
    expect(availability).not.toHaveBeenCalled();
  });

  it("config error: fails closed to classic", () => {
    availability.mockReturnValue({ isError: true, error: { status: 500 } });
    renderAt("/journey/c1");
    expect(screen.getByTestId("classic-course")).toBeInTheDocument();
  });

  it("malformed answer: fails closed to classic", () => {
    availability.mockReturnValue({ data: { guided: "yes" } });
    renderAt("/journey/c1");
    expect(screen.getByTestId("classic-course")).toBeInTheDocument();
  });

  it("while asking: shows a quiet loading state, not the classic course", () => {
    availability.mockReturnValue({ isLoading: true });
    renderAt("/journey/c1");
    expect(screen.getByTestId("guided-gate-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("classic-course")).not.toBeInTheDocument();
  });

  it("signed out and off: the public landing page, not the signed-in course page", () => {
    localStorage.clear();
    availability.mockReturnValue({ data: { guided: false } });
    renderAt("/journey/c1");
    expect(screen.getByTestId("classic-landing")).toBeInTheDocument();
  });

  it("only development builds honour ?fixture", () => {
    expect(isFixtureRequested(new URLSearchParams("fixture=1"), true)).toBe(true);
    expect(isFixtureRequested(new URLSearchParams("fixture=1"), false)).toBe(false);
    expect(isFixtureRequested(new URLSearchParams(""), true)).toBe(false);
  });
});

describe("/journey and the native app", () => {
  it("is never claimed by the app-link files (the app must not open it)", () => {
    const wellKnown = resolve(__dirname, "../../../../public/.well-known");
    const aasa = readFileSync(resolve(wellKnown, "apple-app-site-association"), "utf8");
    const assetlinks = readFileSync(resolve(wellKnown, "assetlinks.json"), "utf8");
    expect(aasa).not.toMatch(/journey/);
    expect(assetlinks).not.toMatch(/journey/);
  });
});
