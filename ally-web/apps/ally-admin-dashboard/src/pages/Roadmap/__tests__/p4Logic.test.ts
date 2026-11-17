import "@constants";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ROUTES, en } from "@constants";
import type { RoadmapBuildBrief, RoadmapItemDetail } from "@types";

import { buildMenuActions } from "../components/BuildMenu";
import { releasableServices } from "../components/ReleaseDialog";
import { builderSessionIdOf } from "../RoadmapLegacyRedirect";
import {
  DEEP_LINK_LIMIT,
  briefFitsDeepLink,
  claudeCodeLink,
  isPlausibleFolder,
  openDeepLink,
  promptFor,
  readClaudeCodeFolder,
  writeClaudeCodeFolder,
} from "../utils/claudeCode";
import { isAuthorOf, outcomeLine, shippedFacts } from "../utils/delight";
import {
  SHORTCUTS_INTRO_AFTER_VISITS,
  hasCelebrated,
  markCelebrated,
  recordVisit,
  shouldIntroduceShortcuts,
} from "../utils/localStore";
import { primaryActionFor } from "../utils/primaryAction";
import {
  builderTarget,
  canSeeAgent,
  canSeeSettings,
  movedStateOf,
  productRoadmapTarget,
} from "../utils/redirects";
import {
  formFromSettings,
  parseHeldPaths,
  patchFromForm,
  readWindow,
  writeWindow,
} from "../utils/settingsForm";

const brief = (overrides: Partial<RoadmapBuildBrief> = {}): RoadmapBuildBrief => ({
  code: "OPP-0388",
  markdown: "# OPP-0388: Streak\n\nProblem…",
  length: 30,
  fitsDeepLink: true,
  filename: "OPP-0388-brief.md",
  branch: "opp-0388-streak",
  prTitle: "OPP-0388: Streak",
  ...overrides,
});

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("redirect mapping (§5.7)", () => {
  it("sends ?opportunity= and ?plan= to the idea page", () => {
    expect(productRoadmapTarget("?opportunity=abc-uuid")).toEqual({
      to: ROUTES.ROADMAP_IDEA("abc-uuid"),
      from: "productRoadmap",
      landed: "idea",
    });
    expect(productRoadmapTarget("?plan=def")?.to).toBe(ROUTES.ROADMAP_IDEA("def"));
  });

  it("sends ?tab=bugs to Bugs and ?tab=interviews to its own entry", () => {
    expect(productRoadmapTarget("?tab=bugs")?.to).toBe(ROUTES.ROADMAP_BUGS);
    expect(productRoadmapTarget("?tab=interviews")?.to).toBe(ROUTES.USER_INTERVIEWS);
  });

  it("keeps My drafts on the old page until it has a Roadmap tab", () => {
    expect(productRoadmapTarget("?tab=drafts")).toBeNull();
  });

  it("sends the bare board to All ideas", () => {
    expect(productRoadmapTarget("")).toEqual({
      to: `${ROUTES.ROADMAP}?view=all`,
      from: "productRoadmap",
      landed: "allIdeas",
    });
  });

  it("sends /builder and /builder/decisions to For you", () => {
    for (const path of ["/builder", "/builder/", "/builder/decisions"]) {
      expect(builderTarget(path, "builder")).toEqual({
        to: `${ROUTES.ROADMAP}?view=for-you`,
        from: "builder",
        landed: "forYou",
      });
    }
  });

  it("sends Builder's pages to the Agent tab", () => {
    expect(builderTarget("/builder/pipeline", "builder")?.to).toBe(
      ROUTES.ROADMAP_AGENT_SECTION("pipeline"),
    );
    expect(builderTarget("/builder/scoreboard", "builder")?.to).toBe(
      ROUTES.ROADMAP_AGENT_SECTION("scoreboard"),
    );
    expect(builderTarget("/builder/knowledge", "owner")?.to).toBe(
      ROUTES.ROADMAP_AGENT_SECTION("knowledge"),
    );
    expect(builderTarget("/builder/eval", "owner")?.to).toBe(ROUTES.ROADMAP_AGENT_SECTION("evals"));
    expect(builderTarget("/builder/sessions", "owner")?.to).toBe(
      ROUTES.ROADMAP_AGENT_SECTION("history"),
    );
  });

  it("sends /builder/settings to Settings for an Owner, the Agent tab for anyone else", () => {
    expect(builderTarget("/builder/settings", "owner")?.to).toBe(ROUTES.ROADMAP_SETTINGS);
    expect(builderTarget("/builder/settings", "builder")?.to).toBe(
      ROUTES.ROADMAP_AGENT_SECTION("pipeline"),
    );
  });

  it("sends a session to its idea, and keeps a session with no idea on its old page", () => {
    expect(builderTarget("/builder/sess-1", "builder", "OPP-0388")?.to).toBe(
      ROUTES.ROADMAP_IDEA("OPP-0388"),
    );
    expect(builderTarget("/builder/sess-1", "builder", null)).toBeNull();
  });

  it("tells a session path from Builder's named pages", () => {
    expect(builderSessionIdOf("/builder/sess-1")).toBe("sess-1");
    expect(builderSessionIdOf("/builder/settings")).toBeNull();
    expect(builderSessionIdOf("/builder")).toBeNull();
  });

  it("reads the moved banner off router state, and ignores anything else", () => {
    expect(movedStateOf({ roadmapMoved: { from: "builder", landed: "forYou" } })).toEqual({
      from: "builder",
      landed: "forYou",
    });
    expect(movedStateOf({ roadmapMoved: { from: "elsewhere", landed: "x" } })).toBeNull();
    expect(movedStateOf(null)).toBeNull();
    const copy = en.roadmapV2Tools.moved;
    expect(copy.banner(copy.from.builder, copy.landed.forYou)).toBe(
      "Builder is now Roadmap → For you",
    );
  });

  it("shows Agent to Builders and Owners, Settings to Owners only", () => {
    expect([canSeeAgent("idea"), canSeeAgent("builder"), canSeeAgent("owner")]).toEqual([
      false,
      true,
      true,
    ]);
    expect([canSeeSettings("builder"), canSeeSettings("owner")]).toEqual([false, true]);
  });
});

describe("Open in Claude Code (§4.5b)", () => {
  it("builds the desktop deep link with the prompt and folder encoded", () => {
    const link = claudeCodeLink("Build OPP-1 & ship", "/Users/me/ally platform");
    expect(link).toBe(
      "claude://code/new?q=Build%20OPP-1%20%26%20ship&folder=%2FUsers%2Fme%2Fally%20platform",
    );
  });

  it("sends a short brief whole, and a long one as a short prompt pointing at the download", () => {
    expect(promptFor(brief())).toBe(brief().markdown);
    const long = brief({ fitsDeepLink: false, length: 20_000 });
    const prompt = promptFor(long);
    expect(prompt).toContain("~/Downloads/OPP-0388-brief.md");
    expect(prompt).toContain("opp-0388-streak");
    expect(prompt.length).toBeLessThan(400);
  });

  it("never trusts a fitsDeepLink that the markdown contradicts", () => {
    expect(
      briefFitsDeepLink({ fitsDeepLink: true, markdown: "x".repeat(DEEP_LINK_LIMIT + 1) }),
    ).toBe(false);
  });

  it("keeps the folder in this browser, and survives blocked storage", () => {
    expect(readClaudeCodeFolder()).toBeNull();
    writeClaudeCodeFolder(" /Users/me/ally-platform ");
    expect(readClaudeCodeFolder()).toBe("/Users/me/ally-platform");
    const getItem = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      expect(readClaudeCodeFolder()).toBeNull();
    } finally {
      getItem.mockRestore();
    }
  });

  it("accepts only absolute paths", () => {
    expect(isPlausibleFolder("/Users/me/ally-platform")).toBe(true);
    expect(isPlausibleFolder("~/code/ally-platform")).toBe(true);
    expect(isPlausibleFolder("C:\\code\\ally-platform")).toBe(true);
    expect(isPlausibleFolder("ally-platform")).toBe(false);
    expect(isPlausibleFolder("")).toBe(false);
  });

  describe("did the app open", () => {
    const original = window.location;
    beforeEach(() => {
      vi.useFakeTimers();
      // jsdom can't navigate; a plain object takes the href.
      Object.defineProperty(window, "location", { value: { href: "" }, writable: true });
    });
    afterEach(() => {
      vi.useRealTimers();
      Object.defineProperty(window, "location", { value: original, writable: true });
    });

    it("offers Copy brief when nothing took focus away", () => {
      const onDidNotOpen = vi.fn();
      openDeepLink("claude://code/new?q=x", onDidNotOpen, 3000);
      expect(window.location.href).toBe("claude://code/new?q=x");
      vi.advanceTimersByTime(3000);
      expect(onDidNotOpen).toHaveBeenCalledTimes(1);
    });

    it("stays quiet when the page lost focus to the app", () => {
      const onDidNotOpen = vi.fn();
      openDeepLink("claude://code/new?q=x", onDidNotOpen, 3000);
      window.dispatchEvent(new Event("blur"));
      vi.advanceTimersByTime(3000);
      expect(onDidNotOpen).not.toHaveBeenCalled();
    });
  });
});

describe("Build ▾ (§4.5b, D21)", () => {
  it("offers Build here with startBuild, and the brief with exportBrief", () => {
    expect(buildMenuActions({ startBuild: true }, { phone: false, hasFolder: false })).toEqual([
      "buildHere",
    ]);
    expect(
      buildMenuActions({ startBuild: true, exportBrief: true }, { phone: false, hasFolder: true }),
    ).toEqual([
      "buildHere",
      "openInClaudeCode",
      "copyBrief",
      "downloadBrief",
      "previewBrief",
      "changeFolder",
    ]);
    expect(buildMenuActions({}, { phone: false, hasFolder: false })).toEqual([]);
  });

  it("replaces Open in Claude Code with the hint on a phone", () => {
    const actions = buildMenuActions(
      { startBuild: true, exportBrief: true },
      { phone: true, hasFolder: true },
    );
    expect(actions).not.toContain("openInClaudeCode");
    expect(actions).not.toContain("changeFolder");
    expect(actions).toContain("copyBrief");
  });

  it("is the primary action at Ready to build with either right", () => {
    const ready = {
      shownStage: "planning" as const,
      statusParts: {
        stage: "planning",
        step: "ready",
        leadUserId: 2,
        prdPercent: 100,
        openQuestions: 0,
        designAwaitingApproval: false,
      },
      lead: { id: 2, name: "Priya", role: "builder" as const },
    };
    expect(primaryActionFor({ ...ready, can: { exportBrief: true } })).toBe("build");
    expect(primaryActionFor({ ...ready, can: { startBuild: true } })).toBe("build");
    expect(primaryActionFor({ ...ready, can: {} })).toBeNull();
  });
});

describe("Release (P5's plan)", () => {
  it("offers the services still waiting to go live, backends first, never mobile", () => {
    expect(
      releasableServices({
        releases: [
          { service: "frontend", state: "pending", repo: "r", prNumber: 1 },
          { service: "be", state: "pending", repo: "r", prNumber: 1 },
          { service: "ai", state: "live", repo: "r", prNumber: 1 },
          { service: "mobile", state: "pending", repo: "r", prNumber: 1 },
        ],
      }),
    ).toEqual(["be", "frontend"]);
  });

  it("offers every service when nothing is recorded yet", () => {
    expect(releasableServices({ releases: [] })).toEqual(["be", "ai", "learn", "frontend"]);
  });
});

describe("Settings form (P0's fields)", () => {
  it("reads P0's hours and P5's HH:MM alike", () => {
    expect(readWindow({ startHour: 9, endHour: 18, timezone: "Europe/London" })).toEqual({
      days: null,
      startHour: 9,
      endHour: 18,
      timeZone: "Europe/London",
    });
    expect(
      readWindow({ start: "22:00", end: "00:00", timeZone: "Asia/Kolkata", days: [1] }),
    ).toEqual({ days: [1], startHour: 22, endHour: 24, timeZone: "Asia/Kolkata" });
    expect(readWindow(null)).toBeNull();
  });

  it("writes a window both the PATCH DTO and the policy can read", () => {
    expect(
      writeWindow({ days: [5, 1], startHour: 22, endHour: 24, timeZone: "Asia/Kolkata" }),
    ).toEqual({
      startHour: 22,
      endHour: 24,
      timezone: "Asia/Kolkata",
      days: [1, 5],
      start: "22:00",
      end: "00:00",
      timeZone: "Asia/Kolkata",
    });
    // Every day is the same as no day filter.
    expect(
      writeWindow({ days: [0, 1, 2, 3, 4, 5, 6], startHour: 1, endHour: 2, timeZone: "" }).days,
    ).toBeNull();
  });

  it("treats empty held paths as the defaults", () => {
    expect(parseHeldPaths("  \n\n")).toBeNull();
    expect(parseHeldPaths("a/**\n a/** \n**/*billing*\n")).toEqual(["a/**", "**/*billing*"]);
  });

  it("refuses limits out of the DTO's ranges", () => {
    const form = formFromSettings(undefined);
    expect(patchFromForm(form)).toMatchObject({
      releaseWindow: null,
      autoReleaseHeldPaths: null,
      inProgressLimit: 3,
      maxLeadCeilingUsd: 200,
      awaitingReviewAmberDays: 5,
    });
    expect(patchFromForm({ ...form, inProgressLimit: "13" })).toBeNull();
    expect(patchFromForm({ ...form, awaitingReviewAmberDays: "0" })).toBeNull();
    expect(patchFromForm({ ...form, maxLeadCeilingUsd: "" })).toBeNull();
    expect(patchFromForm({ ...form, windowOn: true, days: [] })).toBeNull();
    expect(patchFromForm({ ...form, windowOn: true, startHour: 10, endHour: 10 })).toBeNull();
  });
});

describe("switch day and delight (§4.14, §4.15)", () => {
  it("counts one visit per browser session, and introduces shortcuts after the third", () => {
    expect(recordVisit()).toBe(1);
    expect(recordVisit()).toBe(1);
    window.sessionStorage.clear();
    recordVisit();
    window.sessionStorage.clear();
    const visits = recordVisit();
    expect(visits).toBe(SHORTCUTS_INTRO_AFTER_VISITS);
    expect(shouldIntroduceShortcuts(2, false)).toBe(false);
    expect(shouldIntroduceShortcuts(visits, false)).toBe(true);
    expect(shouldIntroduceShortcuts(visits, true)).toBe(false);
  });

  it("celebrates each shipped idea once", () => {
    expect(hasCelebrated("OPP-1")).toBe(false);
    markCelebrated("opp-1");
    expect(hasCelebrated("OPP-1")).toBe(true);
  });

  it("writes the outcome line in plain words", () => {
    expect(outcomeLine({ verdict: "hit", observed: "Next-day return went from 41% to 52%" })).toBe(
      "Hit target: Next-day return went from 41% to 52%",
    );
    expect(outcomeLine({ observed: "  A  change " })).toBe("A change");
    expect(outcomeLine("Plain")).toBe("Plain");
    expect(outcomeLine({ verdict: "miss" })).toBe("");
    expect(outcomeLine(undefined)).toBe("");
  });

  it("names the apps that went live and the first live date", () => {
    const facts = shippedFacts({
      votes: 23,
      statusParts: { stage: "shipped" },
      releases: [
        {
          service: "frontend",
          state: "live",
          releasedAt: "2026-11-05T10:00:00Z",
          repo: "r",
          prNumber: 1,
        },
        {
          service: "be",
          state: "live",
          releasedAt: "2026-11-03T10:00:00Z",
          repo: "r",
          prNumber: 1,
        },
        { service: "ai", state: "pending", repo: "r", prNumber: 1 },
      ],
    } as Pick<RoadmapItemDetail, "releases" | "votes" | "statusParts">);
    expect(facts.apps).toEqual(["Admin and helpline", "Backend"]);
    expect(facts.date).toBe("3 Nov");
    expect(facts.backers).toBe(23);
  });

  it("knows the author by id, whatever its type", () => {
    const item = { author: { id: 7, name: "Ravi", role: "idea" as const } };
    expect(isAuthorOf(item, "7")).toBe(true);
    expect(isAuthorOf(item, 8)).toBe(false);
    expect(isAuthorOf(item, undefined)).toBe(false);
  });
});
