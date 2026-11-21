import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EditableText } from "../EditableText";

describe("EditableText", () => {
  it("is plain text for a visitor", () => {
    render(<EditableText editable={false} value="Hello" placeholder="Add" tag="h1" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Hello");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("renders nothing for a visitor when there is no text", () => {
    const { container } = render(<EditableText editable={false} value="" placeholder="Add" />);
    expect(container.firstChild).toBeNull();
  });

  it("is an editable textbox for an editor, labelled by its placeholder", () => {
    render(
      <EditableText editable value="Hello" placeholder="Add the heading" onChange={vi.fn()} />,
    );
    const box = screen.getByRole("textbox", { name: "Add the heading" });
    expect(box.textContent).toBe("Hello");
    expect(box.getAttribute("contenteditable")).toBe("true");
  });

  it("commits the change once, when focus leaves", () => {
    const onChange = vi.fn();
    render(<EditableText editable value="Hello" placeholder="Add" onChange={onChange} />);
    const box = screen.getByRole("textbox");
    box.textContent = "  Hello there  ";
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(box);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("Hello there");
  });

  it("does not report a change when nothing changed", () => {
    const onChange = vi.fn();
    render(<EditableText editable value="Hello" placeholder="Add" onChange={onChange} />);
    fireEvent.blur(screen.getByRole("textbox"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports an emptied text as empty", () => {
    const onChange = vi.fn();
    render(<EditableText editable value="Hello" placeholder="Add" onChange={onChange} />);
    const box = screen.getByRole("textbox");
    box.textContent = "";
    fireEvent.blur(box);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("finishes the edit on Enter for a single line, so no line break is typed", () => {
    render(<EditableText editable value="Hello" placeholder="Add" onChange={vi.fn()} />);
    const box = screen.getByRole("textbox");
    box.focus();
    const proceeded = fireEvent.keyDown(box, { key: "Enter" });
    expect(proceeded).toBe(false);
    expect(document.activeElement).not.toBe(box);
  });

  it("lets a multi-line text take Shift+Enter as a line break", () => {
    render(<EditableText editable multiline value="Hello" placeholder="Add" onChange={vi.fn()} />);
    const box = screen.getByRole("textbox");
    expect(fireEvent.keyDown(box, { key: "Enter", shiftKey: true })).toBe(true);
  });

  it("puts the old text back on Escape", () => {
    const onChange = vi.fn();
    render(<EditableText editable value="Hello" placeholder="Add" onChange={onChange} />);
    const box = screen.getByRole("textbox");
    box.focus();
    box.textContent = "Changed my mind";
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.textContent).toBe("Hello");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows new text from outside, such as another language, while not being edited", () => {
    const { rerender } = render(
      <EditableText editable value="Hello" placeholder="Add" onChange={vi.fn()} />,
    );
    rerender(<EditableText editable value="नमस्ते" placeholder="Add" onChange={vi.fn()} />);
    expect(screen.getByRole("textbox").textContent).toBe("नमस्ते");
  });
});
