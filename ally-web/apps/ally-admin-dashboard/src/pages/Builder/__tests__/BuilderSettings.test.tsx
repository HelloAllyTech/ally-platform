import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@components", () => ({ cellTypes: {} }));
vi.mock("@assets", () => ({ TooltipIcon: () => <svg /> }));
vi.mock("@utils", () => ({
  formatDate: (d: string) => `full:${d}`,
  formatRelativeTime: (d: string) => `rel:${d}`,
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<any>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  CarbonToggle: ({ id, labelText, toggled, onToggle, disabled }: any) => (
    <label>
      {labelText}
      <input
        type="checkbox"
        aria-label={labelText}
        checked={toggled}
        disabled={disabled}
        onChange={event => onToggle(event.target.checked)}
      />
    </label>
  ),
  InlineNotification: ({ title }: any) => <div>{title}</div>,
  NumberInput: ({ id, label, value, onChange }: any) => (
    <input
      aria-label={label || id}
      value={value}
      onChange={event => onChange(undefined, { value: event.target.value })}
    />
  ),
  Select: ({ id, labelText, value, onChange, children }: any) => (
    <select aria-label={labelText || id} value={value} onChange={onChange}>
      {children}
    </select>
  ),
  SelectItem: ({ value, text }: any) => <option value={value}>{text}</option>,
  SkeletonText: () => <div>Loading…</div>,
  TextInput: ({ id, labelText, value, onChange }: any) => (
    <input aria-label={labelText || id} value={value} onChange={onChange} />
  ),
  Tooltip: ({ children }: any) => <>{children}</>,
  // The group hands its onChange down so each radio can report its value.
  RadioButtonGroup: ({ children, onChange, valueSelected }: any) => (
    <div role="radiogroup">
      {React.Children.map(children, (child: any) =>
        React.cloneElement(child, {
          checked: child.props.value === valueSelected,
          onSelect: () => onChange(child.props.value),
        }),
      )}
    </div>
  ),
  RadioButton: ({ labelText, value, checked, onSelect, disabled }: any) => (
    <label>
      <input type="radio" value={value} checked={checked} disabled={disabled} onChange={onSelect} />
      {labelText}
    </label>
  ),
}));

vi.mock("@components/action-confirmation-popup", () => ({
  ActionConfirmationPopup: ({ isOpen, title, primaryButton, secondaryButton }: any) =>
    isOpen ? (
      <div role="dialog">
        <p>{title}</p>
        <button onClick={primaryButton.onClick}>{primaryButton.label}</button>
        <button onClick={secondaryButton.onClick}>{secondaryButton.label}</button>
      </div>
    ) : null,
}));

const updateSettings = vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({}) });
let settingsResult: any;
let repoMapsResult: any;

vi.mock("@api", () => ({
  useGetBuilderSettingsQuery: () => settingsResult,
  useGetBuilderRepoMapsQuery: () => repoMapsResult,
  useGetLlmModelsQuery: () => ({
    data: [
      { provider: "anthropic", model: "claude-opus-5", label: "Claude Opus 5" },
      { provider: "anthropic", model: "claude-sonnet-5", label: "Claude Sonnet 5" },
    ],
  }),
  useUpdateBuilderSettingsMutation: () => [updateSettings, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { BuilderSettings } from "../BuilderSettings";

const baseSettings = {
  id: "settings-1",
  enabled: true,
  maxConcurrentBuilds: 3,
  defaultBudgetUsd: "25",
  autoReviewEnabled: false,
  autoApproveEnabled: false,
  autoReleaseEnabled: false,
  autoFixEnabled: false,
  plannerModel: null,
  coderModel: "claude-opus",
  verifierModel: null,
};

describe("BuilderSettings", () => {
  beforeEach(() => {
    updateSettings.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
    settingsResult = { data: baseSettings, isLoading: false, isError: false };
    repoMapsResult = {
      data: {
        maps: [
          { repo: "ally-be", commitSha: "abc1234567", generatedAt: "2026-08-23T00:00:00.000Z" },
        ],
      },
    };
  });

  it("shows a skeleton while loading", () => {
    settingsResult = { data: undefined, isLoading: true, isError: false };
    render(<BuilderSettings />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("round-trips the kill switch and the budget", async () => {
    render(<BuilderSettings />);

    const toggle = screen.getByLabelText("Builder enabled");
    fireEvent.click(toggle);

    fireEvent.click(screen.getByText("Save"));

    await vi.waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false, maxConcurrentBuilds: 3 }),
      );
    });
  });

  describe("validated interview turns", () => {
    const label = "Validated interview turns";

    it("shows the switch on, as the server reports it, with what it does", () => {
      settingsResult = {
        data: { ...baseSettings, validatedTurns: true },
        isLoading: false,
        isError: false,
      };
      render(<BuilderSettings />);

      expect(screen.getByLabelText(label)).toBeChecked();
      expect(
        screen.getByText(/reply reaches you only after it has read what it looked up/),
      ).toBeInTheDocument();
    });

    it("saves the switch turned off, so the previous loop can be reached from here", async () => {
      settingsResult = {
        data: { ...baseSettings, validatedTurns: true },
        isLoading: false,
        isError: false,
      };
      render(<BuilderSettings />);

      fireEvent.click(screen.getByLabelText(label));
      fireEvent.click(screen.getByText("Save"));

      await vi.waitFor(() =>
        expect(updateSettings).toHaveBeenCalledWith(
          expect.objectContaining({ validatedTurns: false, enabled: true }),
        ),
      );
    });

    it("shows and saves a switch the server reports as off", async () => {
      settingsResult = {
        data: { ...baseSettings, validatedTurns: false },
        isLoading: false,
        isError: false,
      };
      render(<BuilderSettings />);

      expect(screen.getByLabelText(label)).not.toBeChecked();
      fireEvent.click(screen.getByLabelText(label));
      fireEvent.click(screen.getByText("Save"));

      await vi.waitFor(() =>
        expect(updateSettings).toHaveBeenCalledWith(
          expect.objectContaining({ validatedTurns: true }),
        ),
      );
    });

    it("neither shows nor sends the switch when the server does not report it yet", async () => {
      render(<BuilderSettings />);

      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
      fireEvent.click(screen.getByText("Save"));

      await vi.waitFor(() => expect(updateSettings).toHaveBeenCalled());
      expect(updateSettings.mock.calls[0][0]).not.toHaveProperty("validatedTurns");
    });
  });

  describe("situation brief", () => {
    const label = "Situation brief before the first question";

    it("sits under validated turns, and saves its own switch", async () => {
      settingsResult = {
        data: { ...baseSettings, validatedTurns: true, situationBrief: true },
        isLoading: false,
        isError: false,
      };
      render(<BuilderSettings />);

      expect(screen.getByLabelText(label)).toBeChecked();
      expect(
        screen.getByText(/shows you what already exists to confirm or correct/),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByLabelText(label));
      fireEvent.click(screen.getByText("Save"));

      await vi.waitFor(() =>
        expect(updateSettings).toHaveBeenCalledWith(
          expect.objectContaining({ situationBrief: false, validatedTurns: true }),
        ),
      );
    });

    it("cannot be changed while validated turns are off — it needs them", () => {
      settingsResult = {
        data: { ...baseSettings, validatedTurns: false, situationBrief: true },
        isLoading: false,
        isError: false,
      };
      render(<BuilderSettings />);

      expect(screen.getByLabelText(label)).toBeDisabled();
    });

    it("is neither shown nor sent by a server that predates it", async () => {
      settingsResult = {
        data: { ...baseSettings, validatedTurns: true },
        isLoading: false,
        isError: false,
      };
      render(<BuilderSettings />);

      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
      fireEvent.click(screen.getByText("Save"));
      await vi.waitFor(() => expect(updateSettings).toHaveBeenCalled());
      expect(updateSettings.mock.calls[0][0]).not.toHaveProperty("situationBrief");
    });
  });

  it("clears a model tier back to the platform default by sending an empty string", async () => {
    render(<BuilderSettings />);

    const coderField = screen.getByLabelText("Coder model");
    fireEvent.change(coderField, { target: { value: "" } });

    fireEvent.click(screen.getByText("Save"));

    await vi.waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ plannerModel: "", coderModel: "", verifierModel: "" }),
      );
    });
  });

  // Builder runs only on opencode, so there is no engine to pick or send.
  it("has no engine picker and sends no engine on save", async () => {
    render(<BuilderSettings />);

    expect(screen.queryByLabelText("Engine")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Save"));

    await vi.waitFor(() => expect(updateSettings).toHaveBeenCalled());
    expect(updateSettings.mock.calls[0][0]).not.toHaveProperty("defaultEngine");
  });

  it("shows repo-map freshness read-only", () => {
    render(<BuilderSettings />);

    expect(screen.getByText("ally-be")).toBeInTheDocument();
    expect(screen.getByText("map from rel:2026-08-23T00:00:00.000Z @ abc1234")).toBeInTheDocument();
  });

  /**
   * The three autonomy switches, ordered by how much they let go of: review
   * only reads, approve vouches for the result, fix writes to a branch someone
   * may be reading.
   *
   * The nesting is the point. Approve is meaningless without review — it fires
   * on a clean review and nothing else — so offering it while review is off
   * would be a control that silently does nothing.
   */
  describe("the autonomy switches", () => {
    it("hides approve until review is on", () => {
      render(<BuilderSettings />);

      expect(
        screen.queryByLabelText("Approve a pull request it found nothing wrong with"),
      ).toBeNull();

      fireEvent.click(screen.getByLabelText("Review its own pull requests"));

      expect(
        screen.getByLabelText("Approve a pull request it found nothing wrong with"),
      ).toBeInTheDocument();
    });

    it("sends both switches on save", async () => {
      settingsResult = {
        data: { ...baseSettings, autoReviewEnabled: true },
        isLoading: false,
        isError: false,
      };
      render(<BuilderSettings />);

      fireEvent.click(screen.getByLabelText("Approve a pull request it found nothing wrong with"));
      fireEvent.click(screen.getByText("Save"));

      await vi.waitFor(() => {
        expect(updateSettings).toHaveBeenCalledWith(
          expect.objectContaining({ autoReviewEnabled: true, autoApproveEnabled: true }),
        );
      });
    });

    /**
     * The ladder, top to bottom: read, vouch, ship. Release is nested under
     * approve because releasing something nobody approved is not a state
     * anyone should be able to reach by accident.
     */
    it("hides release until approve is on", () => {
      settingsResult = {
        data: { ...baseSettings, autoReviewEnabled: true },
        isLoading: false,
        isError: false,
      };
      render(<BuilderSettings />);

      expect(screen.queryByLabelText("Release it to production once it merges")).toBeNull();

      fireEvent.click(screen.getByLabelText("Approve a pull request it found nothing wrong with"));

      expect(screen.getByLabelText("Release it to production once it merges")).toBeInTheDocument();
    });

    it("warns that a failed release reads as done", () => {
      settingsResult = {
        data: { ...baseSettings, autoReviewEnabled: true, autoApproveEnabled: true },
        isLoading: false,
        isError: false,
      };
      render(<BuilderSettings />);

      expect(screen.getByText(/merged-but-not-deployed reads as done/)).toBeInTheDocument();
    });

    /**
     * The approval body is what a reader sees on the pull request, so the help
     * text has to say plainly that a machine is doing the approving — a toggle
     * that reads like a human sign-off would be the wrong thing to hand an
     * admin.
     */
    it("says the approval is a machine one", () => {
      render(<BuilderSettings />);
      fireEvent.click(screen.getByLabelText("Review its own pull requests"));

      expect(screen.getByText(/a machine approved it/)).toBeInTheDocument();
    });
  });

  /**
   * A tier is a model id the runner passes straight to the CLI, so a typo used
   * to reach production and fail at dispatch. Picking from the catalog removes
   * the class of mistake rather than validating it later.
   */
  describe("the model tiers", () => {
    it("offers the catalog rather than a free-text box", () => {
      render(<BuilderSettings />);

      const planner = screen.getByLabelText("Planner model") as HTMLSelectElement;
      const options = Array.from(planner.querySelectorAll("option")).map(o => o.textContent);

      expect(options).toContain("Claude Opus 5 (claude-opus-5)");
      expect(options).toContain("Claude Sonnet 5 (claude-sonnet-5)");
    });

    /** Empty is how a tier falls back to the platform default. */
    it("keeps a blank row for the platform default", () => {
      render(<BuilderSettings />);
      const planner = screen.getByLabelText("Planner model") as HTMLSelectElement;
      expect(planner.querySelector('option[value=""]')).not.toBeNull();
    });

    /**
     * Opening the page must not silently reset a deliberate choice just because
     * the catalog stopped offering it.
     */
    it("keeps a model the catalog no longer lists", () => {
      settingsResult = {
        data: { ...baseSettings, plannerModel: "retired-model-v1" },
        isLoading: false,
        isError: false,
      };
      render(<BuilderSettings />);

      const planner = screen.getByLabelText("Planner model") as HTMLSelectElement;
      expect(planner.value).toBe("retired-model-v1");
    });
  });

  describe("the autonomy level", () => {
    const radio = (name: RegExp) => screen.getByRole("radio", { name });

    it("sends the picked level on save, not the switches it stands for", async () => {
      render(<BuilderSettings />);

      fireEvent.click(radio(/^Assist/));
      fireEvent.click(screen.getByText("Save"));

      await vi.waitFor(() => expect(updateSettings).toHaveBeenCalled());
      const body = updateSettings.mock.calls[0][0];
      expect(body).toMatchObject({ autonomyLevel: "assist", enabled: true });
      expect(body).not.toHaveProperty("autoReviewEnabled");
      expect(body).not.toHaveProperty("autoMergeEnabled");
    });

    it("names what each step up risks", () => {
      render(<BuilderSettings />);
      expect(screen.getByText(/lands on master without a person reading it/)).toBeInTheDocument();
      expect(screen.getByText(/reach real users with no person in between/)).toBeInTheDocument();
    });

    it("asks before switching to Auto, and does nothing if cancelled", async () => {
      render(<BuilderSettings />);

      fireEvent.click(radio(/^Auto ?Also releases/));
      expect(screen.getByRole("dialog")).toHaveTextContent("Let Builder release on its own?");
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(radio(/^Auto ?Also releases/)).not.toBeChecked();

      fireEvent.click(radio(/^Auto ?Also releases/));
      fireEvent.click(screen.getByRole("button", { name: "Switch to Auto" }));
      expect(radio(/^Auto ?Also releases/)).toBeChecked();

      fireEvent.click(screen.getByText("Save"));
      await vi.waitFor(() =>
        expect(updateSettings).toHaveBeenCalledWith(
          expect.objectContaining({ autonomyLevel: "auto" }),
        ),
      );
    });

    it("shows a mix of switches as Custom, with Advanced open", () => {
      settingsResult = {
        data: { ...baseSettings, autoReviewEnabled: true, autonomyLevel: "custom" },
        isLoading: false,
        isError: false,
      };
      render(<BuilderSettings />);

      expect(radio(/Custom \(set below\)/)).toBeChecked();
      expect(screen.getByText("Advanced").closest("details")).toHaveAttribute("open");
    });

    it("keeps Advanced folded for a named level", () => {
      settingsResult = {
        data: { ...baseSettings, autonomyLevel: "off" },
        isLoading: false,
        isError: false,
      };
      render(<BuilderSettings />);
      expect(screen.getByText("Advanced").closest("details")).not.toHaveAttribute("open");
      expect(screen.queryByRole("radio", { name: /Custom/ })).toBeNull();
    });

    it("shows the track record and applies a suggested level straight away", async () => {
      settingsResult = {
        data: {
          ...baseSettings,
          autoReviewEnabled: true,
          autoFixEnabled: true,
          autoApproveEnabled: true,
          autoMergeEnabled: false,
          autonomyLevel: "assist",
          trackRecord: {
            window: 10,
            cleanReviewed: 7,
            mergedAsReviewed: 7,
            escalated: 2,
            unhealthyReleases: 0,
          },
          suggestedLevel: "auto_merge",
        },
        isLoading: false,
        isError: false,
      };
      render(<BuilderSettings />);

      expect(
        screen.getByText(
          "Last 10 reviewed pull requests: 7 approved clean, 7 merged as reviewed, 2 needed a person, 0 unhealthy releases.",
        ),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Switch to Auto-merge" }));
      await vi.waitFor(() =>
        expect(updateSettings).toHaveBeenCalledWith({ autonomyLevel: "auto_merge" }),
      );
    });

    it("confirms a suggested switch to Auto before applying it", async () => {
      settingsResult = {
        data: { ...baseSettings, autonomyLevel: "auto_merge", suggestedLevel: "auto" },
        isLoading: false,
        isError: false,
      };
      render(<BuilderSettings />);

      fireEvent.click(screen.getAllByRole("button", { name: "Switch to Auto" })[0]);
      expect(updateSettings).not.toHaveBeenCalled();
      const dialog = screen.getByRole("dialog");
      fireEvent.click(
        Array.from(dialog.querySelectorAll("button")).find(
          b => b.textContent === "Switch to Auto",
        )!,
      );
      await vi.waitFor(() =>
        expect(updateSettings).toHaveBeenCalledWith({ autonomyLevel: "auto" }),
      );
    });
  });

  describe("the per-pull-request spend limit", () => {
    const label = "Most Builder may spend per pull request on review and fixes ($)";

    it("saves the limit with the rest", async () => {
      settingsResult = {
        data: { ...baseSettings, maxPrAutomationUsd: "10.00" },
        isLoading: false,
        isError: false,
      };
      render(<BuilderSettings />);

      const field = screen.getByLabelText(label);
      expect(field).toHaveValue("10");
      fireEvent.change(field, { target: { value: "15" } });
      fireEvent.click(screen.getByText("Save"));

      await vi.waitFor(() =>
        expect(updateSettings).toHaveBeenCalledWith(
          expect.objectContaining({ maxPrAutomationUsd: 15, enabled: true }),
        ),
      );
    });

    it("sends 0 for no limit when the field is cleared", async () => {
      settingsResult = {
        data: { ...baseSettings, maxPrAutomationUsd: "10.00" },
        isLoading: false,
        isError: false,
      };
      render(<BuilderSettings />);

      fireEvent.change(screen.getByLabelText(label), { target: { value: "" } });
      fireEvent.click(screen.getByText("Save"));

      await vi.waitFor(() =>
        expect(updateSettings).toHaveBeenCalledWith(
          expect.objectContaining({ maxPrAutomationUsd: 0 }),
        ),
      );
    });

    it("leaves the limit alone when the server does not report one yet", async () => {
      render(<BuilderSettings />);
      fireEvent.click(screen.getByText("Save"));

      await vi.waitFor(() => expect(updateSettings).toHaveBeenCalled());
      expect(updateSettings.mock.calls[0][0]).not.toHaveProperty("maxPrAutomationUsd");
    });
  });
});
