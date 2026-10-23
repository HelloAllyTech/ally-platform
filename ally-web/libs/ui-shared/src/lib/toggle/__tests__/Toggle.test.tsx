import React from "react";

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";

import Toggle from "../Toggle";

describe("Toggle Component", () => {
  const mockItems = [
    { label: "Option A", value: "optionA" },
    { label: "Option B", value: "optionB" },
  ];

  const defaultProps = {
    items: mockItems,
    onChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Snapshot Tests ---
  describe("Snapshot Tests", () => {
    it("should match snapshot with default props", () => {
      const { asFragment } = render(<Toggle {...defaultProps} />);
      expect(asFragment()).toMatchSnapshot();
    });

    it("should match snapshot with label", () => {
      const { asFragment } = render(<Toggle {...defaultProps} label="Choose option" />);
      expect(asFragment()).toMatchSnapshot();
    });

    it("should match snapshot with second item selected", () => {
      const { asFragment } = render(<Toggle {...defaultProps} />);

      const secondOption = screen.getByText("Option B");
      fireEvent.click(secondOption);

      expect(asFragment()).toMatchSnapshot();
    });

    it("should match snapshot with different items", () => {
      const customItems = [
        { label: "Public", value: "public" },
        { label: "Private", value: "private" },
      ];
      const { asFragment } = render(<Toggle items={customItems} onChange={vi.fn()} />);
      expect(asFragment()).toMatchSnapshot();
    });
  });

  // --- Basic Rendering Tests ---
  describe("Basic Rendering", () => {
    it("should render without crashing", () => {
      expect(() => render(<Toggle {...defaultProps} />)).not.toThrow();
    });

    it("should render all items", () => {
      render(<Toggle {...defaultProps} />);

      expect(screen.getByText("Option A")).toBeInTheDocument();
      expect(screen.getByText("Option B")).toBeInTheDocument();
    });

    it("should render label when provided", () => {
      render(<Toggle {...defaultProps} label="Select Mode" />);

      expect(screen.getByText("Select Mode")).toBeInTheDocument();
    });

    it("should not render label when not provided", () => {
      render(<Toggle {...defaultProps} />);

      expect(screen.queryByText("Select Mode")).not.toBeInTheDocument();
    });

    it("should render the correct number of items", () => {
      const threeItems = [
        { label: "One", value: "1" },
        { label: "Two", value: "2" },
        { label: "Three", value: "3" },
      ];
      render(<Toggle items={threeItems} onChange={vi.fn()} />);

      expect(screen.getByText("One")).toBeInTheDocument();
      expect(screen.getByText("Two")).toBeInTheDocument();
      expect(screen.getByText("Three")).toBeInTheDocument();
    });
  });

  // --- Selection Tests ---
  describe("Selection Behavior", () => {
    it("should have first item selected by default", () => {
      render(<Toggle {...defaultProps} />);

      expect(screen.getByText("Option A")).toHaveAttribute("aria-checked", "true");
      expect(screen.getByText("Option B")).toHaveAttribute("aria-checked", "false");
    });

    it("should call onChange with correct value when item is clicked", () => {
      const onChange = vi.fn();
      render(<Toggle items={mockItems} onChange={onChange} />);

      const secondOption = screen.getByText("Option B");
      fireEvent.click(secondOption);

      expect(onChange).toHaveBeenCalledWith("optionB");
    });

    it("should call onChange with first item value when first item is clicked", () => {
      const onChange = vi.fn();
      render(<Toggle items={mockItems} onChange={onChange} />);

      const firstOption = screen.getByText("Option A");
      fireEvent.click(firstOption);

      expect(onChange).toHaveBeenCalledWith("optionA");
    });

    it("should update selection when second item is clicked", () => {
      const { container } = render(<Toggle {...defaultProps} />);

      const secondOption = screen.getByText("Option B");
      fireEvent.click(secondOption);

      expect(secondOption).toHaveAttribute("aria-checked", "true");
      expect(container.querySelectorAll('[aria-checked="true"]')).toHaveLength(1);
    });

    it("should toggle back to first item when clicked", () => {
      const { container } = render(<Toggle {...defaultProps} />);

      // Click second option
      fireEvent.click(screen.getByText("Option B"));

      // Click first option
      fireEvent.click(screen.getByText("Option A"));

      expect(screen.getByText("Option A")).toHaveAttribute("aria-checked", "true");
      expect(container.querySelectorAll('[aria-checked="true"]')).toHaveLength(1);
    });

    it("should call onChange each time an item is clicked", () => {
      const onChange = vi.fn();
      render(<Toggle items={mockItems} onChange={onChange} />);

      fireEvent.click(screen.getByText("Option B"));
      fireEvent.click(screen.getByText("Option A"));
      fireEvent.click(screen.getByText("Option B"));

      expect(onChange).toHaveBeenCalledTimes(3);
      expect(onChange).toHaveBeenNthCalledWith(1, "optionB");
      expect(onChange).toHaveBeenNthCalledWith(2, "optionA");
      expect(onChange).toHaveBeenNthCalledWith(3, "optionB");
    });
  });

  // --- Styling Tests ---
  describe("Styling", () => {
    it("should apply correct container styles", () => {
      const { container } = render(<Toggle {...defaultProps} />);

      const outerContainer = container.firstChild as HTMLElement;
      expect(outerContainer).toHaveClass("flex");
      expect(outerContainer).toHaveClass("flex-col");
      expect(outerContainer).toHaveClass("gap-2");
      expect(outerContainer).toHaveClass("w-fit");
    });

    it("should apply correct inner container styles", () => {
      const { container } = render(<Toggle {...defaultProps} />);

      const innerContainer = container.querySelector('[role="radiogroup"]');
      expect(innerContainer).toHaveClass("inline-flex");
      expect(innerContainer).toHaveClass("border");
      expect(innerContainer).toHaveClass("border-typography-900");
      expect(innerContainer).not.toHaveClass("rounded-full");
    });

    it("should apply correct item styles", () => {
      const { container } = render(<Toggle {...defaultProps} />);

      const items = container.querySelectorAll(".cursor-pointer");
      items.forEach(item => {
        expect(item).toHaveClass(
          "h-8 px-4 cursor-pointer transition-colors font-primary font-normal",
        );
        expect(item).not.toHaveClass("rounded-full");
      });
    });

    it("should apply active color to selected item", () => {
      render(<Toggle {...defaultProps} />);

      const firstOption = screen.getByText("Option A");
      expect(firstOption).toHaveClass("bg-typography-900", "text-white");
      expect(firstOption).toHaveAttribute("aria-checked", "true");
    });

    it("should apply inactive color to non-selected item", () => {
      render(<Toggle {...defaultProps} />);

      const secondOption = screen.getByText("Option B");
      expect(secondOption).toHaveClass("text-typography-700");
      expect(secondOption).toHaveAttribute("aria-checked", "false");
    });

    it("should update colors when selection changes", () => {
      render(<Toggle {...defaultProps} />);

      fireEvent.click(screen.getByText("Option B"));

      const firstOption = screen.getByText("Option A");
      const secondOption = screen.getByText("Option B");

      expect(firstOption).toHaveClass("text-typography-700");
      expect(secondOption).toHaveClass("bg-typography-900", "text-white");
    });

    it("should mark the selection on the segment itself, with no sliding indicator", () => {
      const { container } = render(<Toggle {...defaultProps} />);

      expect(container.querySelector(".absolute")).toBeNull();
    });
  });

  // --- More than two options ---
  describe("Three or more options", () => {
    // The old sliding pill was half the group wide, so with a third option the
    // highlight sat between segments. The selected segment now carries it itself.
    it("highlights exactly the chosen segment among three", () => {
      render(
        <Toggle
          items={[
            { label: "Daily", value: "daily" },
            { label: "Weekly", value: "weekly" },
            { label: "Monthly", value: "monthly" },
          ]}
          onChange={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByText("Monthly"));

      expect(screen.getByText("Monthly")).toHaveClass("bg-typography-900");
      expect(screen.getByText("Daily")).not.toHaveClass("bg-typography-900");
      expect(screen.getByText("Weekly")).not.toHaveClass("bg-typography-900");
    });
  });

  // --- Edge Cases ---
  describe("Edge Cases", () => {
    it("should handle items with special characters in labels", () => {
      const specialItems = [
        { label: "Option #1 @test", value: "opt1" },
        { label: "Option $2 &more", value: "opt2" },
      ];
      render(<Toggle items={specialItems} onChange={vi.fn()} />);

      expect(screen.getByText("Option #1 @test")).toBeInTheDocument();
      expect(screen.getByText("Option $2 &more")).toBeInTheDocument();
    });

    it("should handle items with long labels", () => {
      const longItems = [
        { label: "This is a very long option label that should still render", value: "long1" },
        { label: "Another extremely lengthy label for testing purposes", value: "long2" },
      ];
      render(<Toggle items={longItems} onChange={vi.fn()} />);

      expect(
        screen.getByText("This is a very long option label that should still render"),
      ).toBeInTheDocument();
    });

    it("should handle items with empty string labels", () => {
      const emptyLabelItems = [
        { label: "", value: "empty" },
        { label: "Non-empty", value: "nonempty" },
      ];
      render(<Toggle items={emptyLabelItems} onChange={vi.fn()} />);

      expect(screen.getByText("Non-empty")).toBeInTheDocument();
    });

    it("should handle rapid clicking", () => {
      const onChange = vi.fn();
      render(<Toggle items={mockItems} onChange={onChange} />);

      const optionA = screen.getByText("Option A");
      const optionB = screen.getByText("Option B");

      // Rapid clicks
      fireEvent.click(optionB);
      fireEvent.click(optionA);
      fireEvent.click(optionB);
      fireEvent.click(optionA);
      fireEvent.click(optionB);

      expect(onChange).toHaveBeenCalledTimes(5);
    });

    it("should handle clicking the same option multiple times", () => {
      const onChange = vi.fn();
      render(<Toggle items={mockItems} onChange={onChange} />);

      const optionA = screen.getByText("Option A");

      fireEvent.click(optionA);
      fireEvent.click(optionA);
      fireEvent.click(optionA);

      expect(onChange).toHaveBeenCalledTimes(3);
      expect(onChange).toHaveBeenCalledWith("optionA");
    });
  });

  // --- Accessibility Tests ---
  describe("Accessibility", () => {
    it("should have clickable items", () => {
      render(<Toggle {...defaultProps} />);

      const items = screen.getAllByText(/Option/);
      items.forEach(item => {
        expect(item).toHaveClass("cursor-pointer");
      });
    });

    it("should render items with unique keys", () => {
      const { container } = render(<Toggle {...defaultProps} />);

      const items = container.querySelectorAll(".cursor-pointer");
      expect(items.length).toBe(2);
    });

    it("should expose a radiogroup with radio options", () => {
      render(<Toggle {...defaultProps} label="Mode" />);

      const group = screen.getByRole("radiogroup", { name: "Mode" });
      expect(group).toBeInTheDocument();

      const radios = screen.getAllByRole("radio");
      expect(radios).toHaveLength(2);
      expect(radios[0]).toHaveAttribute("aria-checked", "true");
      expect(radios[1]).toHaveAttribute("aria-checked", "false");
    });

    it("should render options as real buttons", () => {
      render(<Toggle {...defaultProps} />);

      screen.getAllByRole("radio").forEach(radio => {
        expect(radio.tagName).toBe("BUTTON");
        expect(radio).toHaveAttribute("type", "button");
      });
    });

    it("should apply roving tabindex to the selected option only", () => {
      render(<Toggle {...defaultProps} />);

      const radios = screen.getAllByRole("radio");
      expect(radios[0]).toHaveAttribute("tabindex", "0");
      expect(radios[1]).toHaveAttribute("tabindex", "-1");
    });

    it("should move selection with ArrowRight/ArrowLeft", () => {
      const onChange = vi.fn();
      render(<Toggle items={mockItems} onChange={onChange} />);

      const radios = screen.getAllByRole("radio");
      fireEvent.keyDown(radios[0], { key: "ArrowRight" });
      expect(onChange).toHaveBeenCalledWith("optionB");
      expect(radios[1]).toHaveAttribute("aria-checked", "true");

      fireEvent.keyDown(radios[1], { key: "ArrowLeft" });
      expect(onChange).toHaveBeenCalledWith("optionA");
      expect(radios[0]).toHaveAttribute("aria-checked", "true");
    });

    it("should wrap selection with arrow keys", () => {
      const onChange = vi.fn();
      render(<Toggle items={mockItems} onChange={onChange} />);

      const radios = screen.getAllByRole("radio");
      // ArrowLeft from first wraps to last
      fireEvent.keyDown(radios[0], { key: "ArrowLeft" });
      expect(onChange).toHaveBeenCalledWith("optionB");
    });

    it("should jump to ends with Home/End", () => {
      const onChange = vi.fn();
      render(<Toggle items={mockItems} onChange={onChange} />);

      const radios = screen.getAllByRole("radio");
      fireEvent.keyDown(radios[0], { key: "End" });
      expect(onChange).toHaveBeenCalledWith("optionB");

      fireEvent.keyDown(radios[1], { key: "Home" });
      expect(onChange).toHaveBeenCalledWith("optionA");
    });
  });

  // --- Component Structure Tests ---
  describe("Component Structure", () => {
    it("should have correct DOM hierarchy", () => {
      const { container } = render(<Toggle {...defaultProps} label="Test Label" />);

      const outerContainer = container.firstChild;
      expect(outerContainer).not.toBeNull();

      // Should have label div and inner container
      expect(outerContainer?.childNodes.length).toBe(2);
    });

    it("should render one radio per item directly inside the group", () => {
      const { container } = render(<Toggle {...defaultProps} />);

      const group = container.querySelector('[role="radiogroup"]');
      expect(group?.children).toHaveLength(mockItems.length);
      expect(group?.firstElementChild).toHaveAttribute("role", "radio");
    });
  });
});
