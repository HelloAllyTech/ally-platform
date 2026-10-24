import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FeatureToggleKey, Permissions } from "@constants";

let userState: { permissions: string[]; features: string[] };
vi.mock("react-redux", () => ({
  useSelector: (select: (state: unknown) => unknown) => select({ user: userState }),
}));

// eslint-disable-next-line import/first
import { deriveAllyGuideAccess, useAllyGuideAccess } from "../useAllyGuideAccess";

const NOTHING = {
  canView: false,
  canEdit: false,
  canReadTranscripts: false,
  canViewOrg: false,
  canEditOrg: false,
};

describe("deriveAllyGuideAccess", () => {
  it("grants nothing to an admin who holds neither half", () => {
    expect(deriveAllyGuideAccess([], [])).toEqual(NOTHING);
    expect(deriveAllyGuideAccess(undefined, undefined)).toEqual(NOTHING);
  });

  it("needs the toggle AND the permission to view the console — either alone separates nobody", () => {
    expect(deriveAllyGuideAccess([Permissions.VIEW_ALLY_GUIDE], []).canView).toBe(false);
    expect(deriveAllyGuideAccess([], [FeatureToggleKey.ALLY_GUIDE]).canView).toBe(false);
    expect(
      deriveAllyGuideAccess([Permissions.VIEW_ALLY_GUIDE], [FeatureToggleKey.ALLY_GUIDE]).canView,
    ).toBe(true);
  });

  it("gates editing on the edit permission, separately from viewing", () => {
    const viewOnly = deriveAllyGuideAccess(
      [Permissions.VIEW_ALLY_GUIDE],
      [FeatureToggleKey.ALLY_GUIDE],
    );
    expect(viewOnly).toMatchObject({ canView: true, canEdit: false });

    const editor = deriveAllyGuideAccess(
      [Permissions.VIEW_ALLY_GUIDE, Permissions.EDIT_ALLY_GUIDE],
      [FeatureToggleKey.ALLY_GUIDE],
    );
    expect(editor).toMatchObject({ canView: true, canEdit: true });

    // The edit permission without the toggle is the post-role-collapse trap: it must not edit.
    expect(deriveAllyGuideAccess([Permissions.EDIT_ALLY_GUIDE], []).canEdit).toBe(false);
  });

  it("opens transcripts only with the per-person toggle AND the review permission, never via edit", () => {
    expect(
      deriveAllyGuideAccess(
        [Permissions.VIEW_ALLY_GUIDE, Permissions.EDIT_ALLY_GUIDE],
        [FeatureToggleKey.ALLY_GUIDE],
      ).canReadTranscripts,
    ).toBe(false);
    expect(
      deriveAllyGuideAccess([], [FeatureToggleKey.ALLY_GUIDE_TRANSCRIPTS]).canReadTranscripts,
    ).toBe(false);
    expect(
      deriveAllyGuideAccess([Permissions.REVIEW_ALLY_GUIDE_TRANSCRIPTS], []).canReadTranscripts,
    ).toBe(false);
    expect(
      deriveAllyGuideAccess(
        [Permissions.REVIEW_ALLY_GUIDE_TRANSCRIPTS],
        [FeatureToggleKey.ALLY_GUIDE_TRANSCRIPTS],
      ).canReadTranscripts,
    ).toBe(true);
  });

  it("gates the organisation's Ally tab on its own toggle, not the console's", () => {
    // The console toggle alone does not open the org tab...
    expect(
      deriveAllyGuideAccess([Permissions.VIEW_ALLY_GUIDE], [FeatureToggleKey.ALLY_GUIDE])
        .canViewOrg,
    ).toBe(false);
    // ...and the org toggle alone opens the org tab without opening the console.
    const orgOnly = deriveAllyGuideAccess(
      [Permissions.VIEW_ALLY_GUIDE, Permissions.EDIT_ALLY_GUIDE],
      [FeatureToggleKey.ALLY_GUIDE_ORG],
    );
    expect(orgOnly).toMatchObject({
      canViewOrg: true,
      canEditOrg: true,
      canView: false,
      canEdit: false,
    });
  });

  it("lets an org-tab viewer without the edit permission look but not change", () => {
    expect(
      deriveAllyGuideAccess([Permissions.VIEW_ALLY_GUIDE], [FeatureToggleKey.ALLY_GUIDE_ORG]),
    ).toMatchObject({ canViewOrg: true, canEditOrg: false });
  });
});

describe("useAllyGuideAccess", () => {
  beforeEach(() => {
    userState = { permissions: [], features: [] };
  });

  it("reads permissions and toggles from the store, failing closed while they are empty", () => {
    expect(renderHook(() => useAllyGuideAccess()).result.current).toEqual(NOTHING);

    userState = {
      permissions: [Permissions.VIEW_ALLY_GUIDE],
      features: [FeatureToggleKey.ALLY_GUIDE],
    };
    expect(renderHook(() => useAllyGuideAccess()).result.current.canView).toBe(true);
  });
});
