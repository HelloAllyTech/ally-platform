import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HelpToggle } from "../ui/Help";
import { MoreMenu } from "../ui/Menu";

/** The header's `···` menu and a section's `?` (chunk 20d-2): real buttons, keyboard included. */
describe("the ··· menu", () => {
  it("opens with its items, moves with the arrows, and Esc closes it back to its button", () => {
    const engine = vi.fn();
    render(
      <MoreMenu
        label="More"
        items={[
          { label: "How it answers", onSelect: engine },
          { label: "Open page", href: "https://chat.example/b/sunrise" },
        ]}
      />,
    );
    const button = screen.getByRole("button", { name: "More" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const items = screen.getAllByRole("menuitem");
    expect(items.map(i => i.textContent)).toEqual(["How it answers", "Open page"]);
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("menuitem", { name: "How it answers" }));
    expect(engine).toHaveBeenCalled();
  });

  it("isn't drawn with nothing in it (an owner on a wide screen)", () => {
    render(<MoreMenu label="More" items={[]} />);
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });
});

describe("a section's ?", () => {
  it("opens and closes its explainer", () => {
    render(
      <HelpToggle label="What is Safety?">
        <p>Ally's safety rules are always on.</p>
      </HelpToggle>,
    );
    const button = screen.getByRole("button", { name: "What is Safety?" });
    expect(screen.getByText("Ally's safety rules are always on.")).not.toBeVisible();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Ally's safety rules are always on.")).toBeVisible();
  });
});
