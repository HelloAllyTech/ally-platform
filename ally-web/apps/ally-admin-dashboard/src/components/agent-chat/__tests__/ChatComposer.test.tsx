import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { en } from "@constants";

import { ChatComposer } from "../ChatComposer";

const strings = en.agentChat.chat;

describe("agent-chat ChatComposer", () => {
  it("sends trimmed text on Enter and clears the box", () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} onStop={vi.fn()} isStreaming={false} />);

    const box = screen.getByPlaceholderText(strings.placeholder);
    fireEvent.change(box, { target: { value: "  make it shorter  " } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("make it shorter");
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  it("does not send on Shift+Enter, which adds a newline", () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} onStop={vi.fn()} isStreaming={false} />);

    const box = screen.getByPlaceholderText(strings.placeholder);
    fireEvent.change(box, { target: { value: "line one" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("uses the placeholder the page supplies for the session's state", () => {
    render(
      <ChatComposer
        onSend={vi.fn()}
        onStop={vi.fn()}
        isStreaming={false}
        placeholder="What should I change?"
      />,
    );
    expect(screen.getByPlaceholderText("What should I change?")).toBeInTheDocument();
  });

  it("turns Send into Stop while a turn streams", () => {
    const onStop = vi.fn();
    render(<ChatComposer onSend={vi.fn()} onStop={onStop} isStreaming />);

    expect(screen.queryByText(strings.send)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(strings.stop));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("locks the box while a turn streams", () => {
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} isStreaming />);
    expect(screen.getByPlaceholderText(strings.placeholder)).toBeDisabled();
  });

  // The character interview lets the next answer be drafted while the agent replies.
  it("leaves the box editable while streaming when asked, but still won't send", () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} onStop={vi.fn()} isStreaming editableWhileStreaming />);

    const box = screen.getByPlaceholderText(strings.placeholder);
    expect(box).not.toBeDisabled();
    fireEvent.change(box, { target: { value: "she is 34" } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
    // The draft survives for when the reply lands.
    expect((box as HTMLTextAreaElement).value).toBe("she is 34");
  });

  it("will not send while disabled", () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} onStop={vi.fn()} isStreaming={false} disabled />);

    const box = screen.getByPlaceholderText(strings.placeholder);
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
  });
});
