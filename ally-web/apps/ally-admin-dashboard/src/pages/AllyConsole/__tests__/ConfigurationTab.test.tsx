import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  overrides: vi.fn(),
  audit: vi.fn(),
  schema: vi.fn(),
  layer: vi.fn(),
  save: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  access: { current: { canEdit: true } as Record<string, boolean> },
}));

vi.mock(
  "@ally-ui-mono/ui-shared",
  async () =>
    (await import("../../../components/ally-guide/__tests__/uiSharedFakes")).uiSharedFakes,
);
vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
vi.mock("@hooks", () => ({ useAllyGuideAccess: () => h.access.current }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideConfigOverridesQuery: () => h.overrides(),
  useGetAllyGuideConfigAuditQuery: () => h.audit(),
  useGetAllyGuideConfigSchemaQuery: () => h.schema(),
  useGetAllyGuideConfigLayerQuery: (arg: unknown) => h.layer(arg),
  useSaveAllyGuideConfigMutation: () => [h.save],
  useGetTracksQuery: () => ({
    data: { data: [{ id: "c-1", title: "Active listening" }], count: 1 },
    isLoading: false,
    isError: false,
  }),
}));

// eslint-disable-next-line import/first
import { ConfigurationTab } from "../ConfigurationTab";

const ok = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });

const OVERRIDES = [
  {
    layer: "org",
    scopeId: "t-1",
    scopeName: "Brightside Helpline",
    values: { releaseWindowMaxTurns: 8, nudgeAfterDays: null },
    version: 2,
    updatedAt: "2026-10-20T09:00:00.000Z",
    updatedBy: "Priya Nair",
  },
  {
    layer: "course",
    scopeId: "c-1",
    scopeName: null,
    values: { sideQuests: false },
    version: 1,
    updatedAt: "2026-10-19T09:00:00.000Z",
    updatedBy: null,
  },
];

const SCHEMA = {
  fields: [
    {
      key: "releaseWindowMaxTurns",
      type: "int",
      description: "How many turns a release window stays open.",
      overridableBy: ["org", "course"],
      group: "Steering",
      releaseValue: 6,
      unit: "turns",
    },
    {
      key: "crisis.copyLocked",
      type: "boolean",
      description: "Crisis copy is always the approved text.",
      overridableBy: [],
      pinned: true,
      group: "Safety",
      releaseValue: true,
    },
    {
      key: "sideQuests",
      type: "boolean",
      description: "Whether side quests are offered.",
      overridableBy: ["course"],
      group: "Steering",
      releaseValue: true,
    },
  ],
};

const COURSE_VIEW = {
  layer: "course",
  scopeId: "c-1",
  scopeName: "Active listening",
  version: 2,
  updatedAt: null,
  updatedBy: null,
  fields: [
    {
      key: "sideQuests",
      type: "boolean",
      description: "Whether side quests are offered.",
      overridableBy: ["course"],
      group: "Steering",
      releaseValue: true,
      override: null,
    },
  ],
  audit: [],
};

describe("ConfigurationTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.access.current = { canEdit: true };
    h.overrides.mockReturnValue(ok(OVERRIDES));
    h.audit.mockReturnValue(
      ok([
        {
          layer: "course",
          scopeId: "tr-1",
          scopeName: "First calls",
          key: "sideQuests",
          oldValue: null,
          newValue: { value: false },
          version: 1,
          actor: "Priya Nair",
          actorUserId: 9,
          createdAt: "2026-10-19T09:00:00.000Z",
        },
      ]),
    );
    h.schema.mockReturnValue(ok(SCHEMA));
    h.layer.mockReturnValue(ok(COURSE_VIEW));
    h.save.mockReturnValue({ unwrap: () => Promise.resolve(COURSE_VIEW) });
  });

  describe("where Ally is overridden", () => {
    it("lists each organisation and course that overrides anything, with what it overrides", () => {
      render(<ConfigurationTab />);

      const [org, course] = screen.getAllByTestId("config-override-row");
      expect(org).toHaveTextContent("Organisation");
      expect(org).toHaveTextContent("Brightside Helpline");
      expect(org).toHaveTextContent("2 settings");
      expect(org).toHaveTextContent("releaseWindowMaxTurns = 8");
      expect(org).toHaveTextContent("nudgeAfterDays = Off");
      expect(org).toHaveTextContent("Priya Nair");
      expect(course).toHaveTextContent("Course");
      expect(course).toHaveTextContent("Unnamed");
      expect(course).toHaveTextContent("1 setting");
    });

    it("says plainly that nothing is overridden", () => {
      h.overrides.mockReturnValue(ok([]));
      render(<ConfigurationTab />);

      expect(screen.getByTestId("config-overrides-empty")).toHaveTextContent(
        "Every conversation runs on the live release",
      );
    });

    it("tells a failed read from an empty one, and a missing grant from both", () => {
      h.overrides.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: { status: 500 },
        refetch: vi.fn(),
      });
      const { unmount } = render(<ConfigurationTab />);
      expect(screen.getAllByTestId("ally-load-failed").length).toBeGreaterThan(0);
      unmount();

      h.overrides.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: { status: 403 },
        refetch: vi.fn(),
      });
      render(<ConfigurationTab />);
      expect(screen.getAllByTestId("ally-forbidden").length).toBeGreaterThan(0);
    });
  });

  describe("recent changes", () => {
    it("lists the audit trail, newest first, with who changed what", () => {
      render(<ConfigurationTab />);

      expect(screen.getByTestId("config-audit-row")).toHaveTextContent("sideQuests");
      expect(screen.getByTestId("config-audit-row")).toHaveTextContent("Priya Nair");
      expect(screen.getByTestId("config-audit-scope")).toHaveTextContent("First calls");
      expect(screen.getByTestId("config-audit-scope")).toHaveTextContent("Course");
    });

    it("says when the organisation or course a change applied to no longer exists", () => {
      h.audit.mockReturnValue(
        ok([
          {
            layer: "org",
            scopeId: "org-gone",
            scopeName: null,
            key: "sideQuests",
            oldValue: null,
            newValue: { value: true },
            version: 1,
            actor: null,
            actorUserId: null,
            createdAt: "2026-10-19T09:00:00.000Z",
          },
        ]),
      );
      render(<ConfigurationTab />);
      expect(screen.getByTestId("config-audit-scope")).toHaveTextContent("No longer exists");
      expect(screen.getByTestId("config-audit-scope")).toHaveTextContent("Organisation");
    });

    it("says no override has been changed yet", () => {
      h.audit.mockReturnValue(ok([]));
      render(<ConfigurationTab />);

      expect(screen.getByTestId("config-audit-empty")).toBeInTheDocument();
    });
  });

  describe("the reference of every setting", () => {
    it("groups the keys with the release's value and who may override each", () => {
      render(<ConfigurationTab />);

      const steering = screen.getByTestId("config-reference-Steering");
      expect(steering).toHaveTextContent("releaseWindowMaxTurns");
      expect(steering).toHaveTextContent("6 turns");
      expect(steering).toHaveTextContent("Organisations, Courses");
      expect(steering).toHaveTextContent("Courses");
    });

    it("marks a key in the safety core as fixed, for everyone", () => {
      render(<ConfigurationTab />);

      expect(screen.getByTestId("config-reference-Safety")).toHaveTextContent(
        "Fixed: part of the safety core",
      );
    });
  });

  describe("a course's settings", () => {
    const pickCourse = () =>
      fireEvent.change(screen.getByLabelText("Choose a course"), { target: { value: "c-1" } });

    it("shows no editor until a course is chosen", () => {
      render(<ConfigurationTab />);

      expect(screen.queryByTestId("config-course-editor")).not.toBeInTheDocument();
      expect(h.layer).not.toHaveBeenCalled();
    });

    it("asks for the chosen course's layer and renders its form", () => {
      render(<ConfigurationTab />);

      pickCourse();

      expect(h.layer).toHaveBeenCalledWith({ layer: "course", scopeId: "c-1" });
      expect(
        within(screen.getByTestId("config-course-editor")).getByLabelText("sideQuests"),
      ).toBeInTheDocument();
    });

    it("saves a change with the version it loaded", async () => {
      render(<ConfigurationTab />);
      pickCourse();

      fireEvent.click(screen.getByLabelText("sideQuests"));
      fireEvent.click(screen.getByRole("button", { name: "Save 1 change" }));

      await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
      expect(h.save).toHaveBeenCalledWith({
        layer: "course",
        scopeId: "c-1",
        set: { sideQuests: false },
        clear: [],
        expectedVersion: 2,
      });
    });

    it("offers no save to an admin who can only view", () => {
      h.access.current = { canEdit: false };
      render(<ConfigurationTab />);
      pickCourse();

      expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
      expect(screen.getByLabelText("sideQuests")).toBeDisabled();
    });

    it("says it could not load a course's settings, with a retry", () => {
      const refetch = vi.fn();
      h.layer.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: { status: 404 },
        refetch,
      });
      render(<ConfigurationTab />);
      pickCourse();

      fireEvent.click(
        within(screen.getByTestId("config-course-editor")).getByRole("button", {
          name: "Try again",
        }),
      );
      expect(refetch).toHaveBeenCalled();
    });
  });
});
