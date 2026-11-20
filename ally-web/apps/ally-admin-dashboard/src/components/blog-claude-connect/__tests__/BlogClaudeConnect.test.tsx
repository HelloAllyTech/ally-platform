import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toastFn, state } = vi.hoisted(() => ({
  toastFn: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  state: {
    permissions: ["edit:blog"] as string[],
    keys: [] as unknown[],
    create: vi.fn(),
    revoke: vi.fn(),
  },
}));
vi.mock("sonner", () => ({ toast: toastFn }));
// `src/utils` and `src/components` pull in the real store; stubbed as the Context Library tests do.
vi.mock("@utils", () => ({}));
vi.mock("@components", () => ({ cellTypes: {} }));
vi.mock("@hooks", () => ({ useUser: () => ({ permissions: state.permissions, features: [] }) }));
vi.mock("@api", () => ({
  useGetBlogAuthoringKeysQuery: () => ({ data: state.keys, isLoading: false, isError: false }),
  useCreateBlogAuthoringKeyMutation: () => [state.create, { isLoading: false }],
  useRevokeBlogAuthoringKeyMutation: () => [state.revoke],
}));

import { BlogClaudeConnect, BlogClaudeConnectSheet, testBlogConnection } from "../index";

const unwrapped = (value: unknown) => ({ unwrap: () => Promise.resolve(value) });

beforeEach(() => {
  state.permissions = ["edit:blog"];
  state.keys = [];
  state.create = vi.fn(
    () => unwrapped({ id: "k1", label: "Laptop", key: "bga_secret123", keyPrefix: "bga_secre" }), // gitleaks:allow (a made-up test key)
  );
  state.revoke = vi.fn(() => unwrapped(undefined));
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const createKey = async () => {
  fireEvent.change(screen.getByTestId("blog-connect-label"), { target: { value: "Laptop" } });
  fireEvent.click(screen.getByTestId("blog-connect-create"));
  return screen.findByTestId("blog-connect-key");
};

describe("BlogClaudeConnectSheet", () => {
  it("says what it does in plain words", () => {
    render(<BlogClaudeConnectSheet onClose={vi.fn()} />);
    expect(screen.getByText("Lets Claude Code write blog posts as drafts.")).toBeTruthy();
    expect(screen.getByText("A person always publishes them here.")).toBeTruthy();
  });

  it("shows a new key once, in the shell lines, and not again after Done", async () => {
    render(<BlogClaudeConnectSheet onClose={vi.fn()} />);
    const key = await createKey();
    expect(key.textContent).toBe("bga_secret123");
    expect(state.create).toHaveBeenCalledWith({ label: "Laptop" });
    expect(screen.getByTestId("blog-connect-shell").textContent).toContain(
      'export ALLY_BLOG_KEY="bga_secret123"', // gitleaks:allow (a made-up test key)
    );

    expect(screen.getByTestId("blog-connect-shell").textContent).toContain("ALLY_BLOG_URL=");
    fireEvent.click(screen.getByText("I've copied it"));
    expect(screen.queryByText("bga_secret123")).toBeNull();
    expect(screen.getByTestId("blog-connect-shell").textContent).not.toContain("bga_secret123");
  });

  it("lists keys with last used and revokes one", async () => {
    state.keys = [
      {
        id: "a",
        label: "Work Mac",
        keyPrefix: "bga_abc",
        lastUsedAt: null,
        createdAt: "2026-11-01T00:00:00Z",
      },
      { id: "b", label: "Home", keyPrefix: "bga_def", lastUsedAt: "2026-11-10T00:00:00Z" },
    ];
    render(<BlogClaudeConnectSheet onClose={vi.fn()} />);
    expect(screen.getAllByTestId("blog-key-row")).toHaveLength(2);
    expect(screen.getByText(/never used/)).toBeTruthy();
    expect(screen.getByText(/last used/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Revoke Work Mac"));
    await waitFor(() => expect(state.revoke).toHaveBeenCalledWith("a"));
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith("Work Mac revoked"));
  });

  it("reports a good connection", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: { tools: [] } }),
    });
    render(<BlogClaudeConnectSheet onClose={vi.fn()} />);
    await createKey();
    fireEvent.click(screen.getByTestId("blog-connect-test"));
    await waitFor(() =>
      expect(screen.getByTestId("blog-connect-test-result").getAttribute("data-outcome")).toBe(
        "reachable",
      ),
    );
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer bga_secret123");
    expect(JSON.parse(init.body).method).toBe("tools/list");
  });

  it("reports a refused key and an unreachable endpoint", async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce({ status: 401, json: () => Promise.resolve({}) });
    render(<BlogClaudeConnectSheet onClose={vi.fn()} />);
    await createKey();
    fireEvent.click(screen.getByTestId("blog-connect-test"));
    await waitFor(() =>
      expect(screen.getByTestId("blog-connect-test-result").getAttribute("data-outcome")).toBe(
        "refused",
      ),
    );
    f.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByTestId("blog-connect-test"));
    await waitFor(() =>
      expect(screen.getByTestId("blog-connect-test-result").getAttribute("data-outcome")).toBe(
        "unreachable",
      ),
    );
  });

  it("testBlogConnection never throws", async () => {
    expect(
      await testBlogConnection("http://x", "k", vi.fn().mockRejectedValue(new Error("no"))),
    ).toBe("unreachable");
  });
});

describe("BlogClaudeConnect permission", () => {
  it("renders for people who can edit blogs", () => {
    render(<BlogClaudeConnect open onClose={vi.fn()} />);
    expect(screen.getByTestId("blog-connect")).toBeTruthy();
  });

  it("renders nothing without edit permission", () => {
    state.permissions = ["view:blogs"];
    render(<BlogClaudeConnect open onClose={vi.fn()} />);
    expect(screen.queryByTestId("blog-connect")).toBeNull();
  });
});
