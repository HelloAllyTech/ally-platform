import { describe, expect, it } from "vitest";

import { FeatureToggleKey, Permissions } from "@constants";

import {
  canFileIdeas,
  canLeadRoadmapPlans,
  canManageRoadmap,
  canOpenRoadmapBuilder,
  roadmapRoleFor,
} from "../access";

const EDIT = Permissions.EDIT_PRODUCT_ROADMAP;
const TOGGLE = FeatureToggleKey.PRODUCT_ROADMAP_MANAGE;

describe("canManageRoadmap", () => {
  it("manages with both the permission and the toggle", () => {
    expect(canManageRoadmap([EDIT], [TOGGLE])).toBe(true);
  });

  it("does NOT manage on the permission alone", () => {
    // The case that matters: post role-collapse every platform admin holds EDIT_PRODUCT_ROADMAP,
    // so the toggle is the whole distinction and the permission proves nothing on its own.
    expect(canManageRoadmap([EDIT], ["bug_hunter"])).toBe(false);
  });

  it("does NOT manage on the toggle alone", () => {
    expect(canManageRoadmap([Permissions.VOTE_PRODUCT_ROADMAP], [TOGGLE])).toBe(false);
  });

  it("fails closed when toggles could not be loaded", () => {
    expect(canManageRoadmap([EDIT], [])).toBe(false);
    expect(canManageRoadmap([EDIT], undefined)).toBe(false);
  });

  it("fails closed when permissions have not arrived yet", () => {
    expect(canManageRoadmap(undefined, [TOGGLE])).toBe(false);
  });
});

describe("canOpenRoadmapBuilder", () => {
  const EDIT_BUILDER = Permissions.EDIT_BUILDER;
  const BUILDER = FeatureToggleKey.BUILDER;

  it("opens with Builder access — no roadmap manage needed", () => {
    expect(canOpenRoadmapBuilder([EDIT_BUILDER], [BUILDER])).toBe(true);
  });

  it("does NOT open on roadmap manage alone", () => {
    // The split this exists for: a curator without Builder no longer sees an icon that can only 403.
    expect(canOpenRoadmapBuilder([EDIT], [TOGGLE])).toBe(false);
  });

  it("does NOT open on the Builder toggle without the edit permission", () => {
    expect(canOpenRoadmapBuilder([Permissions.VIEW_BUILDER], [BUILDER])).toBe(false);
  });

  it("fails closed when toggles or permissions are missing", () => {
    expect(canOpenRoadmapBuilder([EDIT_BUILDER], [])).toBe(false);
    expect(canOpenRoadmapBuilder([EDIT_BUILDER], undefined)).toBe(false);
    expect(canOpenRoadmapBuilder(undefined, [BUILDER])).toBe(false);
  });
});

const VOTE = Permissions.VOTE_PRODUCT_ROADMAP;
const VIEW = Permissions.VIEW_PRODUCT_ROADMAP;
const EDIT_BUILDER = Permissions.EDIT_BUILDER;
const ROADMAP = FeatureToggleKey.PRODUCT_ROADMAP;
const BUILDER = FeatureToggleKey.BUILDER;

const IDEA_PERMS = [VIEW, VOTE];
const BUILDER_PERMS = [VIEW, VOTE, EDIT_BUILDER];
const OWNER_PERMS = [VIEW, VOTE, EDIT_BUILDER, EDIT];

describe("roadmapRoleFor", () => {
  it("reads the same role as ally-be: the highest grant wins", () => {
    expect(roadmapRoleFor(IDEA_PERMS, [ROADMAP])).toBe("idea");
    expect(roadmapRoleFor(BUILDER_PERMS, [ROADMAP, BUILDER])).toBe("builder");
    expect(roadmapRoleFor(OWNER_PERMS, [ROADMAP, BUILDER, TOGGLE])).toBe("owner");
  });

  it("needs the permission as well as the toggle", () => {
    expect(roadmapRoleFor([], [ROADMAP, BUILDER, TOGGLE])).toBe("none");
    expect(roadmapRoleFor(IDEA_PERMS, [ROADMAP, BUILDER])).toBe("idea");
  });

  it("makes an org-restricted admin a Viewer at most", () => {
    expect(roadmapRoleFor(OWNER_PERMS, [ROADMAP, BUILDER, TOGGLE], true)).toBe("viewer");
    expect(roadmapRoleFor([], [], true)).toBe("none");
  });

  it("fails closed when toggles could not be loaded", () => {
    expect(roadmapRoleFor(OWNER_PERMS, [])).toBe("none");
    expect(roadmapRoleFor(OWNER_PERMS, undefined)).toBe("none");
  });
});

describe("canFileIdeas", () => {
  it("files with the vote permission and any Roadmap role", () => {
    expect(canFileIdeas(IDEA_PERMS, [ROADMAP])).toBe(true);
    expect(canFileIdeas(BUILDER_PERMS, [ROADMAP, BUILDER])).toBe(true);
    expect(canFileIdeas(OWNER_PERMS, [ROADMAP, BUILDER, TOGGLE])).toBe(true);
  });

  it("does NOT file without a role, or on the vote permission alone", () => {
    expect(canFileIdeas([VOTE], [])).toBe(false);
    expect(canFileIdeas([VOTE], undefined)).toBe(false);
  });

  it("does NOT file without the vote permission", () => {
    expect(canFileIdeas([VIEW], [ROADMAP])).toBe(false);
  });

  it("does NOT file for an org-restricted admin", () => {
    expect(canFileIdeas(IDEA_PERMS, [ROADMAP], true)).toBe(false);
  });
});

describe("canLeadRoadmapPlans", () => {
  it("leads as a Builder or an Owner", () => {
    expect(canLeadRoadmapPlans(BUILDER_PERMS, [ROADMAP, BUILDER])).toBe(true);
    expect(canLeadRoadmapPlans(OWNER_PERMS, [ROADMAP, BUILDER, TOGGLE])).toBe(true);
  });

  it("does NOT lead as an Idea", () => {
    expect(canLeadRoadmapPlans(IDEA_PERMS, [ROADMAP])).toBe(false);
  });

  it("fails closed when restricted or toggles could not be loaded", () => {
    expect(canLeadRoadmapPlans(BUILDER_PERMS, [ROADMAP, BUILDER], true)).toBe(false);
    expect(canLeadRoadmapPlans(BUILDER_PERMS, [])).toBe(false);
    expect(canLeadRoadmapPlans(undefined, undefined)).toBe(false);
  });
});
