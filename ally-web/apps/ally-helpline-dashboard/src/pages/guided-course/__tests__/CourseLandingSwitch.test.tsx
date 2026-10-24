import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { availability } = vi.hoisted(() => ({ availability: vi.fn() }));

vi.mock("@api", () => ({
  useGetGuideAvailabilityQuery: (args: unknown, options: { skip?: boolean }) =>
    options?.skip ? { isUninitialized: true } : availability(args),
}));
vi.mock("../GuidedCourse", () => ({ default: () => null }));
vi.mock("../../course-landing/CourseLanding", () => ({
  CourseLanding: () => <div data-testid="classic-landing" />,
}));

import { CourseLandingSwitch } from "../CourseLandingSwitch";

const Journey = () => {
  const location = useLocation();
  return <div data-testid="journey">{`${location.pathname}${location.search}`}</div>;
};

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/course/:trackId" element={<CourseLandingSwitch />} />
        <Route path="/journey/:trackId" element={<Journey />} />
      </Routes>
    </MemoryRouter>,
  );

describe("CourseLandingSwitch (/course/:id)", () => {
  beforeEach(() => availability.mockReset());
  afterEach(() => localStorage.clear());

  it("a visitor goes to the journey when the course is guided and Ally can talk to visitors", () => {
    availability.mockReturnValue({ data: { guided: true, anonymousChat: true } });
    renderAt("/course/c1?utm_source=wa");
    expect(screen.getByTestId("journey")).toHaveTextContent("/journey/c1?utm_source=wa");
  });

  it("a visitor keeps the classic landing when anonymous chat is off", () => {
    availability.mockReturnValue({ data: { guided: true, anonymousChat: false } });
    renderAt("/course/c1");
    expect(screen.getByTestId("classic-landing")).toBeInTheDocument();
  });

  it("a signed-in learner goes to the journey whenever the course is guided", () => {
    localStorage.setItem("accessToken", "t");
    availability.mockReturnValue({ data: { guided: true, anonymousChat: false } });
    renderAt("/course/c1");
    expect(screen.getByTestId("journey")).toHaveTextContent("/journey/c1");
  });

  it("view=classic is the classic landing, without asking", () => {
    renderAt("/course/c1?view=classic");
    expect(screen.getByTestId("classic-landing")).toBeInTheDocument();
    expect(availability).not.toHaveBeenCalled();
  });

  it("fails closed: an error or a 'no' is the classic landing", () => {
    availability.mockReturnValue({ isError: true });
    const { unmount } = renderAt("/course/c1");
    expect(screen.getByTestId("classic-landing")).toBeInTheDocument();
    unmount();
    availability.mockReturnValue({ data: { guided: false, anonymousChat: true } });
    renderAt("/course/c1");
    expect(screen.getByTestId("classic-landing")).toBeInTheDocument();
  });

  it("asks quietly first, without flashing the classic landing", () => {
    availability.mockReturnValue({ isLoading: true });
    renderAt("/course/c1");
    expect(screen.getByTestId("guided-gate-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("classic-landing")).not.toBeInTheDocument();
  });
});
