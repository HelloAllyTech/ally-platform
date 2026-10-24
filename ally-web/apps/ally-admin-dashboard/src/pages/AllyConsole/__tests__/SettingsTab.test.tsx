import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work, and a mock registered after
// another import that pulls it in arrives too late.
import "@constants";

const h = vi.hoisted(() => ({
  settings: vi.fn(),
  update: vi.fn(),
  isSaving: { current: false },
  tenants: vi.fn(),
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
  useGetAllyGuideSettingsQuery: () => h.settings(),
  useUpdateAllyGuideSettingsMutation: () => [h.update, { isLoading: h.isSaving.current }],
  useGetTenantsQuery: () => h.tenants(),
}));

// eslint-disable-next-line import/first
import { SettingsTab } from "../SettingsTab";

const SWITCHES = {
  enabled: true,
  anonymousChat: false,
  voice: true,
  disabledCapabilities: ["consult_tutor"],
  disabledTenants: ["tenant-a"],
  disabledCourses: ["course-1", "course-2"],
};

const loaded = (data: unknown, extra: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  isError: false,
  error: undefined,
  refetch: vi.fn(),
  ...extra,
});

const accepts = () => h.update.mockReturnValue({ unwrap: () => Promise.resolve(SWITCHES) });

describe("SettingsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.access.current = { canEdit: true };
    h.isSaving.current = false;
    h.settings.mockReturnValue(loaded(SWITCHES));
    h.tenants.mockReturnValue({
      data: {
        data: [
          { id: "tenant-a", name: "Acme Counselling" },
          { id: "tenant-b", name: "Brightside" },
        ],
      },
    });
    accepts();
  });

  describe("what it shows", () => {
    it("reflects the server's switches", () => {
      render(<SettingsTab />);

      expect(within(screen.getByTestId("switch-enabled")).getByRole("switch")).toBeChecked();
      expect(
        within(screen.getByTestId("switch-anonymousChat")).getByRole("switch"),
      ).not.toBeChecked();
      expect(within(screen.getByTestId("switch-voice")).getByRole("switch")).toBeChecked();
    });

    it("lists what Ally is switched off for, naming an organisation rather than its id", () => {
      render(<SettingsTab />);

      expect(
        within(screen.getByTestId("list-courses-chips")).getByText("course-1"),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("list-courses-chips")).getByText("course-2"),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("list-tenants-chips")).getByText("Acme Counselling"),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("list-capabilities-chips")).getByText("consult_tutor"),
      ).toBeInTheDocument();
    });

    it("says how quickly a change reaches learners, and that a read failure fails closed", () => {
      render(<SettingsTab />);

      expect(screen.getByText(/within about 30 seconds/)).toBeInTheDocument();
      expect(
        screen.getByText(/Ally switches itself off and learners see the classic course/),
      ).toBeInTheDocument();
    });

    it("says a list is empty in words", () => {
      h.settings.mockReturnValue(loaded({ ...SWITCHES, disabledCourses: [], disabledTenants: [] }));
      render(<SettingsTab />);

      expect(screen.getByText("No courses are switched off.")).toBeInTheDocument();
      expect(screen.getByText("No organisations are switched off.")).toBeInTheDocument();
    });
  });

  describe("the master switch", () => {
    it("asks first before turning Ally off, and saves nothing until confirmed", () => {
      render(<SettingsTab />);

      fireEvent.click(within(screen.getByTestId("switch-enabled")).getByRole("switch"));

      const dialog = screen.getByRole("dialog", { name: "Turn Ally off for everyone?" });
      expect(within(dialog).getByText(/moved to the classic course page/)).toBeInTheDocument();
      expect(within(dialog).getByText(/Nothing is deleted/)).toBeInTheDocument();
      expect(h.update).not.toHaveBeenCalled();
    });

    it("leaves Ally on, and sends nothing, when the dialog is dismissed", () => {
      render(<SettingsTab />);
      fireEvent.click(within(screen.getByTestId("switch-enabled")).getByRole("switch"));

      fireEvent.click(screen.getByRole("button", { name: "Keep Ally on" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(h.update).not.toHaveBeenCalled();
      expect(within(screen.getByTestId("switch-enabled")).getByRole("switch")).toBeChecked();
    });

    it("sends only { enabled: false } once confirmed, then closes", async () => {
      render(<SettingsTab />);
      fireEvent.click(within(screen.getByTestId("switch-enabled")).getByRole("switch"));

      fireEvent.click(screen.getByRole("button", { name: "Turn Ally off" }));

      await waitFor(() => expect(h.update).toHaveBeenCalledWith({ enabled: false }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(h.toastSuccess).toHaveBeenCalledWith(
        "Saved. Learners see this within about 30 seconds.",
      );
    });

    it("keeps the dialog open and shows the server's message when the save is refused", async () => {
      h.update.mockReturnValue({
        unwrap: () =>
          Promise.reject({ status: 403, data: { message: "Not allowed to change this." } }),
      });
      render(<SettingsTab />);
      fireEvent.click(within(screen.getByTestId("switch-enabled")).getByRole("switch"));

      fireEvent.click(screen.getByRole("button", { name: "Turn Ally off" }));

      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Not allowed to change this."));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("turns Ally back on at once, with no confirmation", async () => {
      h.settings.mockReturnValue(loaded({ ...SWITCHES, enabled: false }));
      render(<SettingsTab />);

      fireEvent.click(within(screen.getByTestId("switch-enabled")).getByRole("switch"));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await waitFor(() => expect(h.update).toHaveBeenCalledWith({ enabled: true }));
    });
  });

  describe("the narrower switches", () => {
    it("save at once, sending only the one that changed", async () => {
      render(<SettingsTab />);

      fireEvent.click(within(screen.getByTestId("switch-voice")).getByRole("switch"));
      await waitFor(() => expect(h.update).toHaveBeenLastCalledWith({ voice: false }));

      fireEvent.click(within(screen.getByTestId("switch-anonymousChat")).getByRole("switch"));
      await waitFor(() => expect(h.update).toHaveBeenLastCalledWith({ anonymousChat: true }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("lock while a save is in flight, so one cannot be flipped twice", () => {
      h.isSaving.current = true;
      render(<SettingsTab />);

      expect(within(screen.getByTestId("switch-voice")).getByRole("switch")).toBeDisabled();
      expect(screen.getByText("Saving…")).toBeInTheDocument();
    });
  });

  describe("the lists", () => {
    it("adds a course id, sending the whole new list", async () => {
      render(<SettingsTab />);

      fireEvent.change(screen.getByLabelText("Courses"), { target: { value: "course-9" } });
      fireEvent.click(screen.getByRole("button", { name: "Add course" }));

      await waitFor(() =>
        expect(h.update).toHaveBeenCalledWith({
          disabledCourses: ["course-1", "course-2", "course-9"],
        }),
      );
    });

    it("trims what was typed before adding it", async () => {
      render(<SettingsTab />);

      fireEvent.change(screen.getByLabelText("Capabilities"), {
        target: { value: "  search_kb  " },
      });
      fireEvent.click(screen.getByRole("button", { name: "Add capability" }));

      await waitFor(() =>
        expect(h.update).toHaveBeenCalledWith({
          disabledCapabilities: ["consult_tutor", "search_kb"],
        }),
      );
    });

    it("refuses a duplicate and a blank, with a reason and no request", () => {
      render(<SettingsTab />);

      fireEvent.change(screen.getByLabelText("Courses"), { target: { value: "course-1" } });
      fireEvent.click(screen.getByRole("button", { name: "Add course" }));
      expect(screen.getByText("That one is already on the list.")).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText("Courses"), { target: { value: "   " } });
      fireEvent.click(screen.getByRole("button", { name: "Add course" }));
      expect(screen.getByText("Enter an id first.")).toBeInTheDocument();

      expect(h.update).not.toHaveBeenCalled();
    });

    it("adds an organisation from a list of organisations, not a pasted id, and offers only the others", async () => {
      render(<SettingsTab />);
      const select = screen.getByLabelText("Organisations");

      // Acme is already off, so it is not offered again.
      expect(
        within(select).queryByRole("option", { name: "Acme Counselling" }),
      ).not.toBeInTheDocument();
      fireEvent.change(select, { target: { value: "tenant-b" } });
      fireEvent.click(screen.getByRole("button", { name: "Add organisation" }));

      await waitFor(() =>
        expect(h.update).toHaveBeenCalledWith({ disabledTenants: ["tenant-a", "tenant-b"] }),
      );
    });

    it("falls back to typing an organisation id when the organisation list is unavailable", () => {
      h.tenants.mockReturnValue({ data: undefined });
      render(<SettingsTab />);

      expect(screen.getByPlaceholderText("Organisation id")).toBeInTheDocument();
    });

    it("removes an entry by name, sending the list without it", async () => {
      render(<SettingsTab />);

      fireEvent.click(screen.getByRole("button", { name: "Remove course-1" }));

      await waitFor(() => expect(h.update).toHaveBeenCalledWith({ disabledCourses: ["course-2"] }));
    });

    it("names the organisation, not its id, on the button that removes it", async () => {
      render(<SettingsTab />);

      fireEvent.click(screen.getByRole("button", { name: "Remove Acme Counselling" }));

      await waitFor(() => expect(h.update).toHaveBeenCalledWith({ disabledTenants: [] }));
    });
  });

  describe("read-only", () => {
    beforeEach(() => {
      h.access.current = { canEdit: false };
    });

    it("says so, and offers nothing that would change a switch", () => {
      render(<SettingsTab />);

      expect(screen.getByText(/View only/)).toBeInTheDocument();
      for (const key of ["enabled", "anonymousChat", "voice"]) {
        expect(within(screen.getByTestId(`switch-${key}`)).getByRole("switch")).toBeDisabled();
      }
      expect(screen.queryByRole("button", { name: "Add course" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add organisation" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add capability" })).not.toBeInTheDocument();
    });

    it("still shows what is switched off, with the remove buttons disabled", () => {
      render(<SettingsTab />);

      expect(screen.getByText("course-1")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remove course-1" })).toBeDisabled();
    });
  });

  describe("states", () => {
    it("shows a skeleton while loading", () => {
      h.settings.mockReturnValue(loaded(undefined, { isLoading: true }));
      render(<SettingsTab />);

      expect(screen.getByTestId("ally-loading")).toBeInTheDocument();
      expect(screen.queryByTestId("switch-enabled")).not.toBeInTheDocument();
    });

    it("never shows switches it could not read: a failure is a failure, not 'everything off'", () => {
      const refetch = vi.fn();
      h.settings.mockReturnValue(
        loaded(undefined, { isError: true, error: { status: 500 }, refetch }),
      );
      render(<SettingsTab />);

      expect(screen.getByTestId("ally-load-failed")).toBeInTheDocument();
      expect(screen.queryByTestId("switch-enabled")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(refetch).toHaveBeenCalled();
    });

    it("tells a missing permission from a failure", () => {
      h.settings.mockReturnValue(loaded(undefined, { isError: true, error: { status: 403 } }));
      render(<SettingsTab />);

      expect(screen.getByTestId("ally-forbidden")).toBeInTheDocument();
    });
  });
});
