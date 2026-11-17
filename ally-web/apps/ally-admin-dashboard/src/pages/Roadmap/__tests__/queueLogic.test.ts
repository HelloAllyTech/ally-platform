import { afterEach, describe, expect, it, vi } from "vitest";

import type { RoadmapItemRow } from "@types";

import { rowsOfItemsResponse } from "../../../api/roadmapV2";
import {
  __resetReduceMotionForTests,
  fadeUpVariants,
  isMotionReduced,
  listStaggerDelay,
  motionTransition,
  paneVariants,
  setReduceMotionSwitch,
} from "../../../motion/roadmapMotion";
import { breakpointFor, hasReadingPane, sidePanelMode } from "../hooks/useRoadmapBreakpoint";
import { keyboardInset } from "../hooks/useVisualViewport";
import { freezeOrder } from "../utils/frozenOrder";
import { queueKeyAction, stepSelection } from "../utils/keyboard";
import { clampPanelWidth, readPref, writePref } from "../utils/prefs";

const row = (code: string, title = code): RoadmapItemRow => ({
  code,
  title,
  shownStage: "submitted",
  statusParts: {},
  author: { id: 1, name: "Ravi", role: "idea" },
  votes: 0,
  votedByMe: false,
  starred: false,
  unread: false,
  updatedAt: "",
  stageSince: "",
});

describe("keyboard", () => {
  const input = document.createElement("input");
  const div = document.createElement("div");

  it("maps J/K/Enter/Esc/? and ⌘K", () => {
    expect(queueKeyAction({ key: "j", target: div })).toBe("next");
    expect(queueKeyAction({ key: "k", target: div })).toBe("previous");
    expect(queueKeyAction({ key: "Enter", target: div })).toBe("open");
    expect(queueKeyAction({ key: "Escape", target: div })).toBe("close");
    expect(queueKeyAction({ key: "?", shiftKey: true, target: div })).toBe("help");
    expect(queueKeyAction({ key: "k", metaKey: true, target: div })).toBe("quickOpen");
    expect(queueKeyAction({ key: "k", ctrlKey: true, target: div })).toBe("quickOpen");
  });

  it("is off while typing, except quick open", () => {
    expect(queueKeyAction({ key: "j", target: input })).toBeNull();
    expect(queueKeyAction({ key: "Enter", target: input })).toBeNull();
    expect(queueKeyAction({ key: "k", metaKey: true, target: input })).toBe("quickOpen");
    const editable = document.createElement("div");
    editable.setAttribute("role", "textbox");
    expect(queueKeyAction({ key: "?", target: editable })).toBeNull();
  });

  it("ignores other chords", () => {
    expect(queueKeyAction({ key: "j", ctrlKey: true, target: div })).toBeNull();
  });

  it("steps through rows without wrapping", () => {
    const codes = ["A", "B", "C"];
    expect(stepSelection(codes, undefined, 1)).toBe("A");
    expect(stepSelection(codes, undefined, -1)).toBe("C");
    expect(stepSelection(codes, "B", 1)).toBe("C");
    expect(stepSelection(codes, "C", 1)).toBe("C");
    expect(stepSelection(codes, "A", -1)).toBe("A");
    expect(stepSelection([], "A", 1)).toBeUndefined();
  });
});

describe("freezeOrder", () => {
  it("keeps places, updates rows in place and fades rows that left", () => {
    const held = [row("A"), row("B"), row("C")];
    const incoming = [row("C"), row("A", "A renamed"), row("D")];
    const result = freezeOrder(held, incoming);
    expect(result.rows.map(r => [r.row.code, r.row.title, r.gone])).toEqual([
      ["A", "A renamed", false],
      ["B", "B", true],
      ["C", "C", false],
    ]);
    expect(result.orderChanged).toBe(true);
  });

  it("reports no change when nothing moved", () => {
    expect(freezeOrder([row("A")], [row("A")]).orderChanged).toBe(false);
  });
});

describe("rowsOfItemsResponse", () => {
  it("flattens sections and skips a section that isn't an array", () => {
    expect(
      rowsOfItemsResponse({
        sections: { needsYou: [row("A")], watching: "oops" as unknown as RoadmapItemRow[] },
      }).map(r => r.code),
    ).toEqual(["A"]);
    expect(rowsOfItemsResponse({ rows: [row("B")], total: 1 }).map(r => r.code)).toEqual(["B"]);
    expect(rowsOfItemsResponse(undefined)).toEqual([]);
  });
});

describe("breakpoints", () => {
  it("uses Carbon's grid", () => {
    expect(breakpointFor(360)).toBe("phone");
    expect(breakpointFor(768)).toBe("tablet");
    expect(breakpointFor(1280)).toBe("laptop");
    expect(breakpointFor(1440)).toBe("desktop");
  });
  it("shows the reading pane from laptop up and the side panel inline only on desktop", () => {
    expect(hasReadingPane("tablet")).toBe(false);
    expect(hasReadingPane("laptop")).toBe(true);
    expect(sidePanelMode("desktop")).toBe("inline");
    expect(sidePanelMode("laptop")).toBe("overlay");
    expect(sidePanelMode("phone")).toBe("tabs");
  });
});

describe("keyboardInset", () => {
  it("measures the keyboard and ignores browser chrome", () => {
    expect(keyboardInset(800, { height: 450, offsetTop: 0 })).toBe(350);
    expect(keyboardInset(800, { height: 760, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(800, null)).toBe(0);
  });
});

describe("prefs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("round-trips a value", () => {
    writePref("showAgentWork", true);
    expect(readPref("showAgentWork", false)).toBe(true);
  });

  it("returns the default when storage throws", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writePref("lastView", "all")).not.toThrow();
    expect(readPref("lastView", "for-you")).toBe("for-you");
  });

  it("clamps the panel width", () => {
    expect(clampPanelWidth(10)).toBe(320);
    expect(clampPanelWidth(9000)).toBe(640);
    expect(clampPanelWidth("x")).toBe(420);
  });
});

describe("reduced motion", () => {
  afterEach(() => {
    setReduceMotionSwitch(false);
    __resetReduceMotionForTests();
  });

  it("the in-app switch turns motion off and back on", () => {
    expect(isMotionReduced()).toBe(false);
    setReduceMotionSwitch(true);
    expect(isMotionReduced()).toBe(true);
    setReduceMotionSwitch(false);
    expect(isMotionReduced()).toBe(false);
  });

  it("collapses every transition to a fade of 100 ms or less", () => {
    expect(motionTransition("celebratory", "expressive", true)).toEqual({
      duration: 0.1,
      ease: "linear",
    });
    expect(motionTransition("slow")).toMatchObject({ duration: 0.4 });
    expect(listStaggerDelay(3, true)).toBe(0);
    expect(listStaggerDelay(3)).toBeCloseTo(0.09);
    expect(listStaggerDelay(9)).toBe(0);
  });

  it("lands on the same final state with and without motion", () => {
    expect(fadeUpVariants(true).animate).toEqual(fadeUpVariants(false).animate);
    expect(paneVariants(true).animate).toEqual(paneVariants(false).animate);
    expect(fadeUpVariants(true).initial).toEqual({ opacity: 0 });
  });
});
