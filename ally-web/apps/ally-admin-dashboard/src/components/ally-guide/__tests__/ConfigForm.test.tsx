import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

vi.mock("@ally-ui-mono/ui-shared", async () => (await import("./uiSharedFakes")).uiSharedFakes);
vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));

// eslint-disable-next-line import/first
import { ConfigForm } from "../ConfigForm";

const view = (overrides: Record<string, unknown> = {}) => ({
  layer: "course",
  scopeId: "c-1",
  scopeName: "Active listening",
  version: 3,
  updatedAt: "2026-10-20T09:00:00.000Z",
  updatedBy: "Priya Nair",
  fields: [
    {
      key: "releaseWindowMaxTurns",
      type: "int",
      min: 1,
      max: 20,
      unit: "turns",
      description: "How many turns a release window stays open.",
      overridableBy: ["org", "course"],
      group: "Steering",
      releaseValue: 6,
      override: null,
    },
    {
      key: "nudgeAfterDays",
      type: "int",
      min: 1,
      max: 30,
      nullable: true,
      description: "Days of quiet before one nudge. Empty is off.",
      overridableBy: ["org", "course"],
      group: "Steering",
      releaseValue: 3,
      override: { value: 5 },
    },
    {
      key: "sideQuests",
      type: "boolean",
      description: "Whether side quests are offered.",
      overridableBy: ["course"],
      group: "Side quests",
      releaseValue: true,
      override: null,
    },
    {
      key: "tone",
      type: "enum",
      enum: ["warm", "plain"],
      description: "The register of Ally's replies.",
      overridableBy: ["course"],
      group: "Conversation",
      releaseValue: "warm",
      override: null,
    },
  ],
  audit: [
    {
      layer: "course",
      scopeId: "tr-1",
      scopeName: "First calls",
      key: "nudgeAfterDays",
      oldValue: null,
      newValue: { value: 5 },
      version: 3,
      actor: "Priya Nair",
      actorUserId: 9,
      createdAt: "2026-10-20T09:00:00.000Z",
    },
  ],
  ...overrides,
});

const renderForm = (props: Record<string, unknown> = {}) => {
  const onSave = vi.fn().mockResolvedValue({});
  const onReload = vi.fn();
  render(
    <ConfigForm
      view={view() as never}
      canEdit
      onSave={onSave}
      onReload={onReload}
      {...(props as object)}
    />,
  );
  return { onSave, onReload };
};

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("ConfigForm", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("what it shows", () => {
    it("groups the settings as the server declares them, each with what it does and the release's value", () => {
      renderForm();

      const form = screen.getByTestId("config-form");
      expect(within(form).getByRole("region", { name: "Steering" })).toBeInTheDocument();
      expect(within(form).getByRole("region", { name: "Side quests" })).toBeInTheDocument();
      const field = screen.getByTestId("config-field-releaseWindowMaxTurns");
      expect(field).toHaveTextContent("How many turns a release window stays open.");
      expect(field).toHaveTextContent("Release: 6 turns");
      expect(screen.getByTestId("config-hint-releaseWindowMaxTurns")).toHaveTextContent(
        "1 to 20 turns",
      );
    });

    it("says which settings are overridden here and which run on the release", () => {
      renderForm();

      expect(screen.getByTestId("config-field-nudgeAfterDays")).toHaveTextContent("Overridden");
      expect(screen.getByTestId("config-field-releaseWindowMaxTurns")).toHaveTextContent(
        "Release value",
      );
    });

    it("shows the override as the value, and the version with who last changed it", () => {
      renderForm();

      expect(screen.getByLabelText("nudgeAfterDays")).toHaveValue("5");
      expect(screen.getByLabelText("releaseWindowMaxTurns")).toHaveValue("6");
      expect(screen.getByTestId("config-version")).toHaveTextContent(
        "Version 3, last changed by Priya Nair",
      );
    });

    it("says nothing has been saved at version 0", () => {
      renderForm({ view: view({ version: 0, updatedBy: null, updatedAt: null }) });

      expect(screen.getByTestId("config-version")).toHaveTextContent("Nothing has been saved");
    });

    it("lists the changes made at this level", () => {
      renderForm();

      const row = screen.getByTestId("config-audit-row");
      expect(row).toHaveTextContent("nudgeAfterDays");
      expect(row).toHaveTextContent("Release value");
      expect(row).toHaveTextContent("5");
      expect(row).toHaveTextContent("Priya Nair");
    });

    it("says a layer with no settings of its own has none to change", () => {
      renderForm({ view: view({ fields: [] }) });

      expect(screen.getByTestId("config-empty")).toBeInTheDocument();
    });
  });

  describe("saving", () => {
    it("starts with nothing to save", () => {
      renderForm();

      expect(screen.getByRole("button", { name: "Save 0 changes" })).toBeDisabled();
      expect(screen.getByText("No unsaved changes.")).toBeInTheDocument();
    });

    it("sends only what changed, with the version it loaded", async () => {
      const { onSave } = renderForm();

      type("releaseWindowMaxTurns", "8");
      fireEvent.click(screen.getByRole("button", { name: "Save 1 change" }));

      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave).toHaveBeenCalledWith({ set: { releaseWindowMaxTurns: 8 }, clear: [] }, 3);
      expect(h.toastSuccess).toHaveBeenCalledWith(
        "Saved. Each conversation picks it up at its next epoch.",
      );
    });

    it("clears an override edited back to the release value rather than writing a copy of it", async () => {
      const { onSave } = renderForm();

      type("nudgeAfterDays", "3");
      fireEvent.click(screen.getByRole("button", { name: "Save 1 change" }));

      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(onSave).toHaveBeenCalledWith({ set: {}, clear: ["nudgeAfterDays"] }, 3);
    });

    it("clears an override on 'Use the release value', and lets you take that back", async () => {
      const { onSave } = renderForm();
      const field = screen.getByTestId("config-field-nudgeAfterDays");

      fireEvent.click(within(field).getByRole("button", { name: "Use the release value" }));
      expect(field).toHaveTextContent("Will go back to the release value on save");
      expect(screen.getByLabelText("nudgeAfterDays")).toHaveValue("3");

      fireEvent.click(within(field).getByRole("button", { name: "Keep my override" }));
      expect(screen.getByRole("button", { name: "Save 0 changes" })).toBeDisabled();

      fireEvent.click(within(field).getByRole("button", { name: "Use the release value" }));
      fireEvent.click(screen.getByRole("button", { name: "Save 1 change" }));
      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(onSave).toHaveBeenCalledWith({ set: {}, clear: ["nudgeAfterDays"] }, 3);
    });

    it("sets a boolean and an enum through their own controls", async () => {
      const { onSave } = renderForm();

      fireEvent.click(screen.getByLabelText("sideQuests"));
      fireEvent.change(screen.getByLabelText("tone"), { target: { value: "plain" } });
      fireEvent.click(screen.getByRole("button", { name: "Save 2 changes" }));

      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(onSave).toHaveBeenCalledWith(
        { set: { sideQuests: false, tone: "plain" }, clear: [] },
        3,
      );
    });

    it("sends an empty box on a nullable setting as off (null)", async () => {
      const { onSave } = renderForm();

      type("nudgeAfterDays", "");
      fireEvent.click(screen.getByRole("button", { name: "Save 1 change" }));

      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(onSave).toHaveBeenCalledWith({ set: { nudgeAfterDays: null }, clear: [] }, 3);
    });

    it("blocks a value outside the limits, says why on the field, and sends nothing", () => {
      const { onSave } = renderForm();

      type("releaseWindowMaxTurns", "99");
      fireEvent.click(screen.getByRole("button", { name: "Save 1 change" }));

      expect(onSave).not.toHaveBeenCalled();
      expect(
        within(screen.getByTestId("config-field-releaseWindowMaxTurns")).getByRole("alert"),
      ).toHaveTextContent("At most 20.");
      expect(screen.getByText("Fix the highlighted settings before saving.")).toBeInTheDocument();
    });

    it("does not call a half-typed value an error until a save is tried", () => {
      renderForm();

      type("releaseWindowMaxTurns", "99");

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("discards the edits back to what is saved", () => {
      renderForm();
      type("releaseWindowMaxTurns", "8");

      fireEvent.click(screen.getByRole("button", { name: "Discard" }));

      expect(screen.getByLabelText("releaseWindowMaxTurns")).toHaveValue("6");
      expect(screen.getByRole("button", { name: "Save 0 changes" })).toBeDisabled();
    });

    it("starts clean when a reload brings a new version", () => {
      const { rerender } = render(
        <ConfigForm view={view() as never} canEdit onSave={vi.fn()} onReload={vi.fn()} />,
      );
      type("releaseWindowMaxTurns", "8");

      rerender(
        <ConfigForm
          view={view({ version: 4 }) as never}
          canEdit
          onSave={vi.fn()}
          onReload={vi.fn()}
        />,
      );

      expect(screen.getByLabelText("releaseWindowMaxTurns")).toHaveValue("6");
    });
  });

  describe("when the save fails", () => {
    it("lists one message per refused key, writes nothing, and keeps the edits", async () => {
      const onSave = vi.fn().mockRejectedValue({
        status: 400,
        data: {
          errorCode: "GUIDE_CONFIG_REFUSED",
          message: [
            "releaseWindowMaxTurns must be at most 20",
            "tone is not a setting you may change",
          ],
        },
      });
      renderForm({ onSave });
      type("releaseWindowMaxTurns", "8");

      fireEvent.click(screen.getByRole("button", { name: "Save 1 change" }));

      const refused = await screen.findByTestId("config-refused");
      expect(refused).toHaveTextContent("Some settings were refused, so nothing was saved");
      expect(refused).toHaveTextContent("releaseWindowMaxTurns must be at most 20");
      expect(refused).toHaveTextContent("tone is not a setting you may change");
      expect(screen.getByLabelText("releaseWindowMaxTurns")).toHaveValue("8");
      // The sentence about a key also sits under that key's own field.
      expect(
        within(screen.getByTestId("config-field-releaseWindowMaxTurns")).getByRole("alert"),
      ).toHaveTextContent("releaseWindowMaxTurns must be at most 20");
    });

    it("says someone else changed it on a 409, and offers a reload instead of overwriting them", async () => {
      const onSave = vi.fn().mockRejectedValue({ status: 409, data: { message: "Someone else" } });
      const { onReload } = renderForm({ onSave });
      type("releaseWindowMaxTurns", "8");

      fireEvent.click(screen.getByRole("button", { name: "Save 1 change" }));

      const stale = await screen.findByTestId("config-stale");
      expect(stale).toHaveTextContent("Someone else changed these settings");
      fireEvent.click(within(stale).getByRole("button", { name: "Reload" }));
      expect(onReload).toHaveBeenCalledTimes(1);
      expect(h.toastError).not.toHaveBeenCalled();
    });

    it("shows the server's own message for any other failure", async () => {
      const onSave = vi
        .fn()
        .mockRejectedValue({ status: 404, data: { message: "Course not found" } });
      renderForm({ onSave });
      type("releaseWindowMaxTurns", "8");

      fireEvent.click(screen.getByRole("button", { name: "Save 1 change" }));

      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("Course not found"));
    });

    it("locks the form while a save is in flight", async () => {
      let finish: (value: unknown) => void = () => undefined;
      const onSave = vi.fn(() => new Promise(resolve => (finish = resolve)));
      renderForm({ onSave });
      type("releaseWindowMaxTurns", "8");

      fireEvent.click(screen.getByRole("button", { name: "Save 1 change" }));

      expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
      expect(screen.getByLabelText("releaseWindowMaxTurns")).toBeDisabled();
      finish({});
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Saving…" })).not.toBeInTheDocument(),
      );
    });
  });

  describe("access", () => {
    it("shows everything but cannot be changed by an admin who can only view", () => {
      renderForm({ canEdit: false });

      expect(screen.getByLabelText("releaseWindowMaxTurns")).toBeDisabled();
      expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Use the release value" }),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("config-view-only")).toBeInTheDocument();
    });
  });
});
