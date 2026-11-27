import "@constants";
import React, { useRef } from "react";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { en } from "@constants";

import { SelectionMenu, menuPosition } from "../components/SelectionMenu";
import { readSelectionWithin, useSelectionMenu } from "../hooks/useSelectionMenu";

const selection = { text: "the judge", rect: { top: 300, left: 100, width: 80, height: 20 } };

describe("SelectionMenu", () => {
  it("shows the two actions over a selection and hides without one", async () => {
    const onAsk = vi.fn();
    const onDraft = vi.fn();
    const { rerender } = render(
      <SelectionMenu selection={selection} onAsk={onAsk} onDraft={onDraft} onClose={vi.fn()} />,
    );
    const copy = en.productManual.selection;
    fireEvent.click(screen.getByRole("button", { name: copy.ask }));
    fireEvent.click(screen.getByRole("button", { name: copy.draft }));
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onDraft).toHaveBeenCalledTimes(1);

    rerender(<SelectionMenu selection={null} onAsk={onAsk} onDraft={onDraft} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole("toolbar")).toBeNull());
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <SelectionMenu selection={selection} onAsk={vi.fn()} onDraft={vi.fn()} onClose={onClose} />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("sits above the selection, below it near the top, and stays on screen", () => {
    expect(menuPosition(selection.rect, 1200)).toEqual({ top: 252, left: 8 });
    expect(menuPosition({ ...selection.rect, top: 20 }, 1200).top).toBe(48);
    expect(menuPosition({ ...selection.rect, left: 1150 }, 1200).left).toBe(1200 - 300 - 8);
  });
});

const Harness: React.FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  const { selection: current } = useSelectionMenu(ref);
  return (
    <div>
      <div ref={ref} data-testid="body">
        <p>Scores come from the judge.</p>
      </div>
      <p data-testid="outside">Elsewhere</p>
      <span data-testid="state">{current ? current.text : "none"}</span>
    </div>
  );
};

const select = (element: Element) => {
  const range = document.createRange();
  range.selectNodeContents(element);
  const current = window.getSelection();
  current?.removeAllRanges();
  current?.addRange(range);
};

describe("useSelectionMenu", () => {
  it("reads only selections inside the body", () => {
    render(<Harness />);
    select(screen.getByTestId("outside"));
    expect(readSelectionWithin(screen.getByTestId("body"), window.getSelection())).toBeNull();
    select(screen.getByText("Scores come from the judge."));
    expect(readSelectionWithin(screen.getByTestId("body"), window.getSelection())?.text).toBe(
      "Scores come from the judge.",
    );
  });

  it("shows after a mouse selection and hides on scroll and Escape", async () => {
    render(<Harness />);
    select(screen.getByText("Scores come from the judge."));
    await act(async () => {
      fireEvent.mouseUp(document);
      await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
    });
    expect(screen.getByTestId("state")).toHaveTextContent("Scores come from the judge.");
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.getByTestId("state")).toHaveTextContent("none");

    await act(async () => {
      fireEvent.mouseUp(document);
      await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
    });
    expect(screen.getByTestId("state")).not.toHaveTextContent("none");
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.getByTestId("state")).toHaveTextContent("none");
  });
});
