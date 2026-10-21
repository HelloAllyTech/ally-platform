import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";

import { ToggleSwitch } from "../ToggleSwitch";

describe("ToggleSwitch", () => {
  it("renders with enabled state", () => {
    const onChange = vi.fn();
    render(<ToggleSwitch enabled={true} onChange={onChange} label="Test Toggle" />);
    const button = screen.getByRole("button", { name: "Test Toggle" });
    expect(button).toBeInTheDocument();
  });

  it("renders with disabled state", () => {
    const onChange = vi.fn();
    render(<ToggleSwitch enabled={false} onChange={onChange} label="Test Toggle" />);
    const button = screen.getByRole("button", { name: "Test Toggle" });
    expect(button).toBeInTheDocument();
  });

  it("calls onChange when clicked", () => {
    const onChange = vi.fn();
    render(<ToggleSwitch enabled={false} onChange={onChange} label="Test Toggle" />);
    const button = screen.getByRole("button", { name: "Test Toggle" });

    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("calls onChange with opposite value when clicked", () => {
    const onChange = vi.fn();
    render(<ToggleSwitch enabled={true} onChange={onChange} label="Test Toggle" />);
    const button = screen.getByRole("button", { name: "Test Toggle" });

    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("has correct aria-label", () => {
    const onChange = vi.fn();
    render(<ToggleSwitch enabled={false} onChange={onChange} label="My Toggle" />);
    const button = screen.getByRole("button", { name: "My Toggle" });
    expect(button).toHaveAttribute("aria-label", "My Toggle");
  });

  it("has correct size classes", () => {
    const onChange = vi.fn();
    render(<ToggleSwitch enabled={false} onChange={onChange} label="Test Toggle" />);
    const button = screen.getByRole("button", { name: "Test Toggle" });
    expect(button.className).toContain("h-6");
    expect(button.className).toContain("w-12");
  });

  it("has rounded corners", () => {
    const onChange = vi.fn();
    render(<ToggleSwitch enabled={false} onChange={onChange} label="Test Toggle" />);
    const button = screen.getByRole("button", { name: "Test Toggle" });
    expect(button.className).toContain("rounded-full");
  });

  it("has transition classes", () => {
    const onChange = vi.fn();
    render(<ToggleSwitch enabled={false} onChange={onChange} label="Test Toggle" />);
    const button = screen.getByRole("button", { name: "Test Toggle" });
    expect(button.className).toContain("transition-colors");
  });

  it("renders toggle indicator", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ToggleSwitch enabled={false} onChange={onChange} label="Test Toggle" />,
    );
    const indicator = container.querySelector("span");
    expect(indicator).toBeInTheDocument();
  });

  it("indicator has correct position when enabled", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ToggleSwitch enabled={true} onChange={onChange} label="Test Toggle" />,
    );
    const indicator = container.querySelector("span");
    expect(indicator?.className).toContain("translate-x-[27px]");
  });

  it("indicator has correct position when disabled", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ToggleSwitch enabled={false} onChange={onChange} label="Test Toggle" />,
    );
    const indicator = container.querySelector("span");
    expect(indicator?.className).toContain("translate-x-[3px]");
  });

  it("exposes its on/off state via aria-pressed", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ToggleSwitch enabled={true} onChange={onChange} label="Test Toggle" />,
    );
    expect(screen.getByRole("button", { name: "Test Toggle" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    rerender(<ToggleSwitch enabled={false} onChange={onChange} label="Test Toggle" />);
    expect(screen.getByRole("button", { name: "Test Toggle" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("indicator has transition classes", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ToggleSwitch enabled={false} onChange={onChange} label="Test Toggle" />,
    );
    const indicator = container.querySelector("span");
    expect(indicator?.className).toContain("transition-transform");
  });

  it("indicator has correct size", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ToggleSwitch enabled={false} onChange={onChange} label="Test Toggle" />,
    );
    const indicator = container.querySelector("span");
    expect(indicator?.className).toContain("h-[18px]");
    expect(indicator?.className).toContain("w-[18px]");
  });

  it("indicator is white", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ToggleSwitch enabled={false} onChange={onChange} label="Test Toggle" />,
    );
    const indicator = container.querySelector("span");
    expect(indicator?.className).toContain("bg-white");
  });
});
