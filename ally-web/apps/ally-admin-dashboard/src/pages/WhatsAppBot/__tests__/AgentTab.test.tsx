import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Chatbot } from "@types";

/**
 * The Agent tab: everything about how the chatbot answers. Platform admins get the Engine card
 * (v1 / Shadow / v2, and Agent mode on v2); editors get what it can answer from and the model.
 */

const ANSWERS = {
  name: "Ally FAQ",
  persona: { displayName: "Ally FAQ" },
  answerMode: "documents_only",
  model: null,
};

let canCreate = false;
const updateSpy = vi.fn(() => ({ unwrap: async () => ({}) }));
let bot: Record<string, unknown> = {};

// The real copy, without the whole constants barrel (which cannot load in isolation).
vi.mock("@constants", async () => ({
  en: (await import("../../../constants/en")).en,
  TooltipLocation: {},
}));

vi.mock("@components", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
  EntityField: ({ label, children }: { label: string; children: React.ReactNode }) => (
    <fieldset>
      <legend>{label}</legend>
      {children}
    </fieldset>
  ),
}));
vi.mock("@components/types", () => ({
  ButtonVariant: { PRIMARY: "primary", SECONDARY: "secondary" },
}));
vi.mock("@utils", () => ({ formatRelativeTime: () => "just now" }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@api", () => ({
  useGetChatbotsQuery: () => ({ data: { chatbots: [], canCreate } }),
  useGetLlmModelsQuery: () => ({ data: [] }),
  useGetChatbotQuery: () => ({ data: bot }),
  useUpdateChatbotMutation: () => [updateSpy, { isLoading: false }],
}));

const { AgentTab } = await import("../AgentTab");

const renderTab = (canEdit = true) =>
  render(<AgentTab bot={bot as unknown as Chatbot} canEdit={canEdit} onTest={vi.fn()} />);

describe("AgentTab — Engine", () => {
  beforeEach(() => {
    canCreate = false;
    bot = { id: "bot-1", runtime: "v1", effectiveRuntime: "v1", features: {}, ...ANSWERS };
  });

  it("is hidden from anyone who is not a platform admin", () => {
    renderTab();
    expect(screen.queryByText("Engine")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Shadow/)).not.toBeInTheDocument();
    // Editors still get how it answers.
    expect(screen.getByText("How it answers")).toBeInTheDocument();
  });

  it("shows platform admins v1, Shadow and v2 with the bot's setting selected", () => {
    canCreate = true;
    bot = { ...bot, runtime: "shadow", effectiveRuntime: "shadow" };
    renderTab();
    expect(screen.getByText("Engine")).toBeInTheDocument();
    expect(screen.getByLabelText(/^v1 —/)).not.toBeChecked();
    expect(screen.getByLabelText(/^Shadow —/)).toBeChecked();
    expect(screen.getByLabelText(/^v2 —/)).not.toBeChecked();
    expect(screen.queryByText(/turned off in Defaults/)).not.toBeInTheDocument();
  });

  it("says when the new engine is turned off platform-wide", () => {
    canCreate = true;
    bot = { ...bot, runtime: "v2", effectiveRuntime: "v1" };
    renderTab();
    expect(screen.getByText(/turned off in Defaults/)).toBeInTheDocument();
  });
});

describe("AgentTab — Agent mode", () => {
  beforeEach(() => {
    canCreate = true;
    updateSpy.mockClear();
    bot = { id: "bot-1", runtime: "v2", effectiveRuntime: "v2", features: {}, ...ANSWERS };
  });

  it("is hidden from anyone who is not a platform admin", () => {
    canCreate = false;
    renderTab();
    expect(screen.queryByLabelText("Agent mode")).not.toBeInTheDocument();
  });

  it("is shown only while the engine is v2", () => {
    bot = { ...bot, runtime: "v1", effectiveRuntime: "v1" };
    renderTab();
    expect(screen.queryByLabelText("Agent mode")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/^v2 —/));
    expect(screen.getByLabelText("Agent mode")).toBeInTheDocument();
  });

  it("shows the saved flag and saves only what changed", () => {
    renderTab();
    const toggle = screen.getByLabelText("Agent mode");
    expect(toggle).not.toBeChecked();
    const save = screen.getByRole("button", { name: "Save engine" });
    expect(save).toBeDisabled();

    fireEvent.click(toggle);
    fireEvent.click(save);
    expect(updateSpy).toHaveBeenCalledWith({ id: "bot-1", features: { agent: true } });
  });

  it("starts on when the bot already has it", () => {
    bot = { ...bot, features: { agent: true } };
    renderTab();
    expect(screen.getByLabelText("Agent mode")).toBeChecked();
  });
});

describe("AgentTab — How it answers", () => {
  beforeEach(() => {
    canCreate = false;
    updateSpy.mockClear();
    bot = { id: "bot-1", runtime: "v2", effectiveRuntime: "v2", features: {}, ...ANSWERS };
  });

  it("shows what it can answer from and saves only that and the model", () => {
    renderTab();
    expect(screen.getByLabelText(/^Only its knowledge/)).toBeChecked();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/^Its knowledge, then general knowledge/));
    fireEvent.click(save);
    expect(updateSpy).toHaveBeenCalledWith({
      id: "bot-1",
      answerMode: "documents_and_general",
      model: null,
    });
  });

  it("lets a viewer look but not change", () => {
    renderTab(false);
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview these changes" })).toBeInTheDocument();
  });
});
