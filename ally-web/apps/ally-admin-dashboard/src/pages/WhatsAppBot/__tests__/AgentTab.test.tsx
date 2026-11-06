import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Chatbot } from "@types";

/**
 * The Agent tab: everything about how the chatbot answers. There is no Engine card: every chatbot
 * answers with the agent, and platform admins are told when the switch in Defaults is off.
 * Editors get what it can answer from and the model.
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

describe("AgentTab — no Engine card", () => {
  beforeEach(() => {
    canCreate = true;
    updateSpy.mockClear();
    bot = { id: "bot-1", effectiveRuntime: "v2", ...ANSWERS };
  });

  it("shows no engine choice or Agent mode toggle, even to platform admins", () => {
    renderTab();
    expect(screen.queryByText("Engine")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Shadow/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^v2 —/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Agent mode")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save engine" })).not.toBeInTheDocument();
    expect(screen.queryByText(/switched off in Defaults/)).not.toBeInTheDocument();
    expect(screen.getByText("How it answers")).toBeInTheDocument();
  });

  it("tells platform admins when the agent is switched off in Defaults", () => {
    bot = { ...bot, effectiveRuntime: "v1" };
    renderTab();
    expect(
      screen.getByText(
        "Answers are in safe mode: “Answer with the agent” is switched off in Defaults.",
      ),
    ).toBeInTheDocument();
  });

  it("does not tell anyone else", () => {
    canCreate = false;
    bot = { ...bot, effectiveRuntime: "v1" };
    renderTab();
    expect(screen.queryByText(/switched off in Defaults/)).not.toBeInTheDocument();
  });
});

describe("AgentTab — How it answers", () => {
  beforeEach(() => {
    canCreate = false;
    updateSpy.mockClear();
    bot = { id: "bot-1", effectiveRuntime: "v2", ...ANSWERS };
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
