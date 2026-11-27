import "@constants";
import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";

const createMock = vi.fn();
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<typeof import("@api")>()),
  useGetManualAgentKeysQuery: () => ({ data: [], isLoading: false }),
  useCreateManualAgentKeyMutation: () => [createMock, { isLoading: false }],
  useRevokeManualAgentKeyMutation: () => [vi.fn()],
}));

import { KeysSection } from "../components/AdminDrawer";
import { KEY_PLACEHOLDER, claudeCodeCommand, mcpJson, repoEnvLines } from "../utils/agentConnect";

const copy = en.productManual.admin;
const URL = "https://api.example.test/api/v1/product-manual/mcp";

describe("agent connect snippets", () => {
  it("builds the one-line Claude Code command", () => {
    expect(claudeCodeCommand(URL, "pmk_abc")).toBe(
      `claude mcp add --scope user --transport http product-manual ${URL} --header "Authorization: Bearer pmk_abc"`,
    );
  });
  it("builds the repo env lines the root .mcp.json reads", () => {
    expect(repoEnvLines(URL, "pmk_abc")).toBe(
      `export ALLY_PRODUCT_MANUAL_URL=${URL}\nexport ALLY_PRODUCT_MANUAL_KEY=pmk_abc`,
    );
  });
  it("builds valid mcpServers JSON", () => {
    expect(JSON.parse(mcpJson(URL, "pmk_abc"))).toEqual({
      mcpServers: {
        "product-manual": { url: URL, headers: { Authorization: "Bearer pmk_abc" } },
      },
    });
  });
});

describe("KeysSection", () => {
  beforeEach(() => createMock.mockReset());

  it("shows the Claude Code command with a placeholder until a key exists", () => {
    render(<KeysSection />);
    const snippet = screen.getByTestId("manual-agent-snippet").textContent ?? "";
    expect(snippet).toContain("claude mcp add --scope user --transport http product-manual");
    expect(snippet).toContain(KEY_PLACEHOLDER);
    expect(screen.getByText(copy.testNeedsKey)).toBeTruthy();
  });

  it("fills the command with the new key and lets the developer switch agent", async () => {
    createMock.mockReturnValue({ unwrap: () => Promise.resolve({ id: "1", key: "pmk_secret" }) });
    render(<KeysSection />);
    fireEvent.change(screen.getByLabelText(copy.keyLabel), { target: { value: "My laptop" } });
    fireEvent.click(screen.getByRole("button", { name: copy.createKey }));
    await waitFor(() => expect(screen.getByTestId("manual-agent-fresh")).toBeTruthy());
    expect(screen.getByTestId("manual-agent-snippet").textContent).toContain("Bearer pmk_secret");

    fireEvent.click(screen.getByRole("tab", { name: copy.targets.other }));
    expect(JSON.parse(screen.getByTestId("manual-agent-snippet").textContent ?? "")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: copy.targets.repo }));
    expect(screen.getByTestId("manual-agent-snippet").textContent).toContain(
      "ALLY_PRODUCT_MANUAL_KEY=pmk_secret",
    );
  });
});
