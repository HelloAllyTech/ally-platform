import React from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COLOR_MODE_STORAGE_KEY, initColorMode } from "@hooks/useColorMode";

import { ColorModeToggle } from "../ColorModeToggle";

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const html = document.documentElement;

describe("ColorModeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    html.className = "";
    html.style.colorScheme = "";
  });

  afterEach(() => {
    localStorage.clear();
    html.className = "";
  });

  it("starts in light mode and offers dark mode with a moon", () => {
    initColorMode();
    render(<ColorModeToggle />);

    const button = screen.getByTestId("color-mode-toggle");
    expect(button).toHaveAttribute("aria-label", "Switch to dark mode");
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("color-mode-icon-moon")).toBeInTheDocument();
    expect(html).not.toHaveClass("dark");
  });

  it("one tap switches to dark, swaps the icon to a sun and remembers the choice", () => {
    initColorMode();
    render(<ColorModeToggle />);

    fireEvent.click(screen.getByTestId("color-mode-toggle"));

    expect(html).toHaveClass("dark");
    // Carbon's dark zone goes on with it, so Carbon components switch too.
    expect(html).toHaveClass("cds--g100");
    expect(html.style.colorScheme).toBe("dark");
    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe("dark");
    expect(screen.getByTestId("color-mode-icon-sun")).toBeInTheDocument();
    expect(screen.queryByTestId("color-mode-icon-moon")).not.toBeInTheDocument();
    expect(screen.getByTestId("color-mode-toggle")).toHaveAttribute(
      "aria-label",
      "Switch to light mode",
    );
  });

  it("a second tap goes back to light", () => {
    initColorMode();
    render(<ColorModeToggle />);
    const button = screen.getByTestId("color-mode-toggle");

    fireEvent.click(button);
    fireEvent.click(button);

    expect(html).not.toHaveClass("dark");
    expect(html).not.toHaveClass("cds--g100");
    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe("light");
    expect(screen.getByTestId("color-mode-icon-moon")).toBeInTheDocument();
  });

  it("restores a saved dark choice on load", () => {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, "dark");
    act(() => initColorMode());
    render(<ColorModeToggle />);

    expect(html).toHaveClass("dark");
    expect(screen.getByTestId("color-mode-icon-sun")).toBeInTheDocument();
  });

  it("falls back to light when storage can't be read", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    initColorMode();
    render(<ColorModeToggle />);

    expect(html).not.toHaveClass("dark");
    spy.mockRestore();
  });
});
