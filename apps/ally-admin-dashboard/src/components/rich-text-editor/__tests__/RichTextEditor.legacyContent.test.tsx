import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RichTextEditor } from "../RichTextEditor";

// Real TipTap, no mocks: the bug lives in what ProseMirror does to the text on
// load, which a mocked editor cannot show.
const asParagraphs = (plain: string) =>
  plain
    .split("\n")
    .map(line => `<p>${line}</p>`)
    .join("");

// The shapes found in production quiz, video and journal prompts, where the
// question text was authored as plain text.
const LEGACY_PROMPTS: Record<string, string> = {
  "trailing space": "Which of these are NOT gender-affirming? ",
  "trailing space and newline": "Which of these are NOT gender-affirming? \n",
  "blank lines between paragraphs": "Pen down your reflections here:\n\nWhat does it mean to you? ",
  "double spaces": "A  double  space",
  "leading space": "  Leading space",
  "tab character": "Tab\tseparated",
};

describe("RichTextEditor with legacy plain-text content", () => {
  it.each(Object.entries(LEGACY_PROMPTS))(
    "does not report %s as an edit on mount",
    async (_label, plain) => {
      const onChange = vi.fn();

      render(<RichTextEditor value={asParagraphs(plain)} onChange={onChange} />);
      await act(async () => {
        await Promise.resolve();
      });

      expect(document.querySelector(".ProseMirror")).not.toBeNull();
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("still reports a real edit made to legacy content", async () => {
    const onChange = vi.fn();
    render(<RichTextEditor value={asParagraphs("Existing question? ")} onChange={onChange} />);
    await act(async () => {
      await Promise.resolve();
    });

    const editor = (document.querySelector(".ProseMirror") as any).editor;
    act(() => {
      editor.commands.insertContent(" And now more.");
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toContain("And now more.");
  });
});
