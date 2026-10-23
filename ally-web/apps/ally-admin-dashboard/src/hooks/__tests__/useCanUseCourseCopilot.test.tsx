import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FeatureToggleKey, Permissions } from "@constants";

let userState: { permissions: string[]; features: string[] };
vi.mock("../useUser", () => ({ useUser: () => userState }));

// eslint-disable-next-line import/first
import { useCanUseCourseCopilot } from "../useCanUseCourseCopilot";

describe("useCanUseCourseCopilot", () => {
  beforeEach(() => {
    userState = { permissions: [], features: [] };
  });

  it("is true only with the toggle, Create Courses AND the edit grant", () => {
    userState = {
      permissions: [Permissions.EDIT_COURSE_COPILOT],
      features: [FeatureToggleKey.COURSE_COPILOT, FeatureToggleKey.CREATE_COURSES],
    };
    expect(renderHook(() => useCanUseCourseCopilot()).result.current).toBe(true);
  });

  // Copilot builds and edits courses, so it follows the admin's Create Courses toggle.
  it("is false when courses are view-only for the admin", () => {
    userState = {
      permissions: [Permissions.EDIT_COURSE_COPILOT],
      features: [FeatureToggleKey.COURSE_COPILOT],
    };
    expect(renderHook(() => useCanUseCourseCopilot()).result.current).toBe(false);
  });

  it("is false with the toggle alone", () => {
    userState = { permissions: [], features: [FeatureToggleKey.COURSE_COPILOT] };
    expect(renderHook(() => useCanUseCourseCopilot()).result.current).toBe(false);
  });

  it("is false with the edit grant alone", () => {
    userState = { permissions: [Permissions.EDIT_COURSE_COPILOT], features: [] };
    expect(renderHook(() => useCanUseCourseCopilot()).result.current).toBe(false);
  });

  // View-only is deliberately not enough: a session list with no chat has nothing to show.
  it("is false with only the view grant", () => {
    userState = {
      permissions: [Permissions.VIEW_COURSE_COPILOT],
      features: [FeatureToggleKey.COURSE_COPILOT],
    };
    expect(renderHook(() => useCanUseCourseCopilot()).result.current).toBe(false);
  });
});
