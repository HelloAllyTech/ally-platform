import { fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isTypingTarget, resolveShortcut, useRoadmapShortcuts } from "../useRoadmapShortcuts";

describe("resolveShortcut", () => {
  it("maps the Bug Hunter keys plus the roadmap's own", () => {
    expect(resolveShortcut("j", false)).toBe("down");
    expect(resolveShortcut("ArrowUp", false)).toBe("up");
    expect(resolveShortcut("o", false)).toBe("open");
    expect(resolveShortcut("a", false)).toBe("accept");
    expect(resolveShortcut("r", false)).toBe("reject");
    expect(resolveShortcut("u", false)).toBe("assignToMe");
    expect(resolveShortcut("z", false)).toBe("undo");
    expect(resolveShortcut("q", false)).toBeNull();
  });

  it("reads ? both ways, and shifted / before plain /", () => {
    expect(resolveShortcut("?", false)).toBe("help");
    expect(resolveShortcut("/", true)).toBe("help");
    expect(resolveShortcut("/", false)).toBe("search");
  });
});

describe("isTypingTarget", () => {
  it("is true for inputs and false for a div", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
  });
});

describe("useRoadmapShortcuts", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const setup = (enabled = true, overrides = {}) => {
    const handlers = {
      rowIds: ["a", "b", "c"],
      cursorId: null as string | null,
      onCursor: vi.fn(),
      onOpen: vi.fn(),
      onSearch: vi.fn(),
      onHelp: vi.fn(),
      ...overrides,
    };
    renderHook(() => useRoadmapShortcuts(enabled, handlers));
    return handlers;
  };

  it("j starts at the first row, k at the last, and both stop at the ends", () => {
    const h = setup();
    fireEvent.keyDown(document.body, { key: "j" });
    expect(h.onCursor).toHaveBeenLastCalledWith("a");
    fireEvent.keyDown(document.body, { key: "k" });
    expect(h.onCursor).toHaveBeenLastCalledWith("c");
  });

  it("clamps at the last row", () => {
    const h = setup(true, { cursorId: "c" });
    fireEvent.keyDown(document.body, { key: "j" });
    expect(h.onCursor).toHaveBeenLastCalledWith("c");
  });

  it("opens the cursor row with o", () => {
    const h = setup(true, { cursorId: "b" });
    fireEvent.keyDown(document.body, { key: "o" });
    expect(h.onOpen).toHaveBeenCalledWith("b");
  });

  it("does nothing while typing, with a modifier, inside a dialog, or when disabled", () => {
    const h = setup(true, { cursorId: "b" });
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "o" });
    fireEvent.keyDown(document.body, { key: "o", metaKey: true });
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    const inner = document.createElement("div");
    dialog.appendChild(inner);
    document.body.appendChild(dialog);
    fireEvent.keyDown(inner, { key: "o" });
    expect(h.onOpen).not.toHaveBeenCalled();

    const off = setup(false, { cursorId: "b" });
    fireEvent.keyDown(document.body, { key: "o" });
    expect(off.onOpen).not.toHaveBeenCalled();
  });

  it("keeps decision keys inert when no handler is supplied", () => {
    const h = setup(true, { cursorId: "b" });
    fireEvent.keyDown(document.body, { key: "a" });
    fireEvent.keyDown(document.body, { key: "r" });
    expect(h.onOpen).not.toHaveBeenCalled();
  });

  it("opens the sheet on ? and focuses search on /", () => {
    const h = setup();
    fireEvent.keyDown(document.body, { key: "?" });
    fireEvent.keyDown(document.body, { key: "/" });
    expect(h.onHelp).toHaveBeenCalledTimes(1);
    expect(h.onSearch).toHaveBeenCalledTimes(1);
  });
});
