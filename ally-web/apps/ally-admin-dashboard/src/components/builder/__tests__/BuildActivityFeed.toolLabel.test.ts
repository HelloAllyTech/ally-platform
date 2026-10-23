import { describe, expect, it, vi } from "vitest";

// Same stubs as the other feed tests: @constants reads off the @components barrel.
vi.mock("@components", () => ({ cellTypes: {} }));
vi.mock("react-markdown", () => ({ default: () => null }));
vi.mock("remark-gfm", () => ({ default: () => undefined }));
vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: () => null,
  Tag: () => null,
  Tile: () => null,
}));

// eslint-disable-next-line import/first
import { toolLabel } from "../BuildActivityFeed";

describe("toolLabel", () => {
  it("labels opencode's lowercase tool ids", () => {
    expect(toolLabel("bash")).toBe("Ran a command");
    expect(toolLabel("webfetch")).toBe("Fetched a page");
  });

  it("still labels Claude Code's capitalised names from older runs", () => {
    expect(toolLabel("Bash")).toBe("Ran a command");
    expect(toolLabel("WebFetch")).toBe("Fetched a page");
  });

  it("falls back to the raw name for tools it has no label for", () => {
    expect(toolLabel("builder_note")).toBe("builder_note");
  });
});
