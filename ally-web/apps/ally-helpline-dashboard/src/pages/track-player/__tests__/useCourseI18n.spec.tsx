import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import i18n from "../../../i18n";
import { useCourseI18n } from "../useCourseI18n";

describe("useCourseI18n", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    localStorage.setItem("i18nextLng", "en");
  });

  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("translates player chrome in the course language", () => {
    const { result } = renderHook(() => useCourseI18n("mr"));

    expect(result.current.language).toBe("mr");
    expect(result.current.t("tracks2.quiz.question.next")).toBe("पुढील");
    expect(result.current.t("tracks2.quiz.question.true")).toBe("बरोबर");
  });

  it("leaves the app language and its persisted choice untouched", () => {
    renderHook(() => useCourseI18n("mr"));

    expect(i18n.language).toBe("en");
    expect(i18n.t("tracks2.quiz.question.next")).toBe("Next");
    expect(localStorage.getItem("i18nextLng")).toBe("en");
  });

  it("returns the app instance while the course language is unknown", () => {
    const { result } = renderHook(() => useCourseI18n(null));

    expect(result.current).toBe(i18n);
  });

  it("resolves a regional code to its bundled language", () => {
    const { result } = renderHook(() => useCourseI18n("hi-IN"));

    expect(result.current.t("tracks2.quiz.question.next")).toBe(
      i18n.t("tracks2.quiz.question.next", { lng: "hi" }),
    );
  });
});
