import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@components", () => ({ cellTypes: {} }));
vi.mock("@assets", () => ({ TooltipIcon: () => <svg /> }));

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
  InlineNotification: ({ title }: any) => <div>{title}</div>,
  SkeletonText: () => <div>Loading…</div>,
  Select: ({ id, labelText, value, onChange, disabled, children }: any) => (
    <select aria-label={labelText || id} value={value} onChange={onChange} disabled={disabled}>
      {children}
    </select>
  ),
  SelectItem: ({ value, text }: any) => <option value={value}>{text}</option>,
  Tooltip: ({ children }: any) => <>{children}</>,
  CarbonToggle: ({ id, labelText, toggled, disabled, onToggle }: any) => (
    <input
      type="checkbox"
      id={id}
      aria-label={labelText}
      checked={toggled}
      disabled={disabled}
      onChange={event => onToggle(event.target.checked)}
    />
  ),
}));

const updateBuilderSettings = vi.fn().mockReturnValue({ unwrap: () => Promise.resolve({}) });
const updateValidatedTurns = vi.fn();
let validatedTurnsResult: any;
let builderResult: any;

vi.mock("@api", () => ({
  useGetBuilderSettingsQuery: () => builderResult,
  useUpdateBuilderSettingsMutation: () => [updateBuilderSettings, { isLoading: false }],
  useGetValidatedAgentTurnsQuery: () => validatedTurnsResult,
  useUpdateValidatedAgentTurnsMutation: () => [updateValidatedTurns, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { AiModelsTab } from "../AiModelsTab";

describe("AiModelsTab", () => {
  beforeEach(() => {
    updateBuilderSettings.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
    updateValidatedTurns.mockReset();
    updateValidatedTurns.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    validatedTurnsResult = {
      data: { courseCopilot: true, characterInterview: true },
      isLoading: false,
      isError: false,
    };
    builderResult = {
      data: {
        id: "settings-1",
        enabled: true,
        maxConcurrentBuilds: 3,
        defaultBudgetUsd: "25",
        plannerModel: null,
        coderModel: "claude-opus-5",
        verifierModel: null,
      },
      isLoading: false,
      isError: false,
    };
  });

  it("shows Builder's models, loaded from its own backend", () => {
    render(<AiModelsTab />);

    expect(screen.getByText("Builder")).toBeInTheDocument();
    expect(screen.queryByText("Bug Hunter")).toBeNull();
    expect(screen.getByLabelText("Coder model")).toHaveValue("claude-opus-5");
  });

  it("saves Builder's section, clearing a blank tier to the platform default", async () => {
    render(<AiModelsTab />);

    fireEvent.change(screen.getByLabelText("Coder model"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Save"));

    await vi.waitFor(() => {
      expect(updateBuilderSettings).toHaveBeenCalledWith({
        plannerModel: "",
        coderModel: "",
        verifierModel: "",
      });
    });
  });

  // Builder runs only on opencode, and the old Bug Hunter's engine picker left with it.
  it("offers no engine picker", () => {
    render(<AiModelsTab />);

    expect(screen.queryByLabelText("Engine")).toBeNull();
  });

  describe("validated turns", () => {
    it("shows one switch per agent, as the server has them", () => {
      validatedTurnsResult.data = { courseCopilot: true, characterInterview: false };
      render(<AiModelsTab />);

      expect(screen.getByText("Validated turns")).toBeInTheDocument();
      expect(screen.getByLabelText("Course Copilot")).toBeChecked();
      expect(screen.getByLabelText("Character interview")).not.toBeChecked();
    });

    it("saves a switch the moment it is flipped, and only that switch", async () => {
      render(<AiModelsTab />);

      fireEvent.click(screen.getByLabelText("Course Copilot"));

      await waitFor(() =>
        expect(updateValidatedTurns).toHaveBeenCalledWith({ courseCopilot: false }),
      );
      await waitFor(() =>
        expect(toastSuccess).toHaveBeenCalledWith("Course Copilot: validated turns off."),
      );
      expect(updateBuilderSettings).not.toHaveBeenCalled();
    });

    it("says so when the switch could not be saved", async () => {
      updateValidatedTurns.mockReturnValue({ unwrap: () => Promise.reject(new Error("403")) });
      render(<AiModelsTab />);

      fireEvent.click(screen.getByLabelText("Character interview"));

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith("Couldn't save the validated-turn setting."),
      );
    });

    it("shows a load failure instead of switches", () => {
      validatedTurnsResult = { data: undefined, isLoading: false, isError: true };
      render(<AiModelsTab />);

      expect(screen.getByText("Couldn't load the validated-turn settings.")).toBeInTheDocument();
      expect(screen.queryByLabelText("Course Copilot")).toBeNull();
    });
  });

  it("shows an error when Builder's settings failed to load", () => {
    builderResult = { data: undefined, isLoading: false, isError: true };
    render(<AiModelsTab />);

    expect(screen.getByText("Couldn't load Builder's model settings.")).toBeInTheDocument();
  });
});
