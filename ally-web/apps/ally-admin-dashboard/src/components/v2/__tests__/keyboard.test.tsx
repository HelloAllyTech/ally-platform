import React from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTO_ADVANCE_MS, OptionList, keysHintFor, useEnterToSubmit } from "../core";
import { TellMeSomethingElse } from "../TellMeSomethingElse";

const options = [
  { id: "a", label: "Clients or customers" },
  { id: "b", label: "My team" },
  { id: "c", label: "Both" },
];

describe("v2 keyboard (DESIGN.md §4)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("picks an option by its letter, shows the tick, then moves on after 380 ms", () => {
    const onChoose = vi.fn();
    render(
      <OptionList
        label="Who?"
        options={options}
        onChoose={onChoose}
        keysHint="Press A, B or C to choose"
      />,
    );
    fireEvent.keyDown(document, { key: "b" });
    expect(screen.getByRole("radio", { name: /My team/ }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(onChoose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(AUTO_ADVANCE_MS));
    expect(onChoose).toHaveBeenCalledWith(options[1]);
    expect(screen.getByText("Press A, B or C to choose")).toBeTruthy();
  });

  it("moves with the arrow keys and picks with Enter", () => {
    const onChoose = vi.fn();
    render(<OptionList label="Who?" options={options} onChoose={onChoose} />);
    const first = screen.getByRole("radio", { name: /Clients/ });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: /My team/ }));
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    act(() => vi.advanceTimersByTime(AUTO_ADVANCE_MS));
    expect(onChoose).toHaveBeenCalledWith(options[1]);
  });

  it("leaves letters alone while typing in a text field", () => {
    const onChoose = vi.fn();
    render(
      <>
        <input aria-label="note" />
        <OptionList label="Who?" options={options} onChoose={onChoose} />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText("note"), { key: "a" });
    act(() => vi.advanceTimersByTime(AUTO_ADVANCE_MS));
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("submits the screen with Enter, but not from a button or text field", () => {
    const onEnter = vi.fn();
    const Screen = () => {
      useEnterToSubmit(onEnter);
      return (
        <>
          <h1 tabIndex={-1}>Question</h1>
          <input aria-label="field" />
        </>
      );
    };
    render(<Screen />);
    fireEvent.keyDown(screen.getByLabelText("field"), { key: "Enter" });
    expect(onEnter).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByText("Question"), { key: "Enter" });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("opens 'Tell me something else', sends, and closes with Esc", () => {
    const onSend = vi.fn();
    render(
      <TellMeSomethingElse
        labels={{
          collapsed: "Tell me something else",
          placeholder: "Correct something",
          send: "Send",
          stop: "Stop",
        }}
        busy={false}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Tell me something else"));
    const input = screen.getByPlaceholderText("Correct something");
    fireEvent.change(input, { target: { value: "We close at 6 on Fridays" } });
    fireEvent.submit(input.closest("form")!);
    expect(onSend).toHaveBeenCalledWith("We close at 6 on Fridays");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByPlaceholderText("Correct something")).toBeNull();
  });

  it("announces the letter keys", () => {
    expect(keysHintFor("Press {keys} to choose", 3)).toBe("Press A, B or C to choose");
  });
});
