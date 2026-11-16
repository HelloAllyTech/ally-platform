import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runTest } = vi.hoisted(() => ({ runTest: vi.fn() }));

vi.mock("@api", () => ({
  useGetLlmModelCatalogQuery: () => ({
    data: [
      { id: "a", label: "Mini", model: "gpt-5-mini", provider: "openai", active: true },
      { id: "b", label: "Retired", model: "old", provider: "openai", active: false },
    ],
  }),
  useTestPromptMutation: () => [runTest, { isLoading: false }],
}));
vi.mock("@components", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@components/types", () => ({ ButtonVariant: { SECONDARY: "secondary" } }));

import { PromptTestRunner } from "../PromptTestRunner";

describe("PromptTestRunner", () => {
  beforeEach(() => runTest.mockReset());

  it("runs the unsaved text on the matching active model and shows the reply", async () => {
    runTest.mockReturnValue({
      unwrap: () =>
        Promise.resolve({ ok: true, text: "Hello there", latencyMs: 42, configName: "Mini" }),
    });
    render(<PromptTestRunner promptText="You are a coach." currentModel="gpt-5-mini" />);
    fireEvent.change(screen.getByPlaceholderText(/I keep freezing/), {
      target: { value: "hi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    await waitFor(() => expect(screen.getByText("Hello there")).toBeInTheDocument());
    expect(runTest).toHaveBeenCalledWith({
      modelId: "a",
      promptText: "You are a coach.",
      sampleInput: "hi",
    });
    // retired models are not offered
    expect(screen.queryByText("Retired")).toBeNull();
  });

  it("shows the provider's own words when the model rejects the call", async () => {
    runTest.mockReturnValue({
      unwrap: () => Promise.resolve({ ok: false, text: "", latencyMs: 5, error: "deprecated", configName: "Mini" }),
    });
    render(<PromptTestRunner promptText="x" />);
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    await waitFor(() => expect(screen.getByText(/deprecated/)).toBeInTheDocument());
  });

  it("disables Run until there is prompt text", () => {
    render(<PromptTestRunner promptText="  " />);
    expect(screen.getByRole("button", { name: "Run test" })).toBeDisabled();
  });
});
