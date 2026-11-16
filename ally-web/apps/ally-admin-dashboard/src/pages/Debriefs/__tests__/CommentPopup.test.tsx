import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAddDebriefCommentMutation: () => [vi.fn(), { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { CommentPopup } from "../session/CommentPopup";

const anchor = { quotedText: "what’s even the point", turnIndex: 5 } as never;

describe("Session › comment popup", () => {
  it("closes on a click anywhere outside it", () => {
    const onDone = vi.fn();
    render(
      <div>
        <p data-testid="outside">elsewhere</p>
        <CommentPopup runId="r1" anchor={anchor} onDone={onDone} />
      </div>,
    );
    fireEvent.mouseDown(screen.getByTestId("comment-popup"));
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("stays open on an outside click while a comment is half-written", () => {
    const onDone = vi.fn();
    render(
      <div>
        <p data-testid="outside">elsewhere</p>
        <CommentPopup runId="r1" anchor={anchor} onDone={onDone} />
      </div>,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "She should pause here" } });
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onDone).not.toHaveBeenCalled();
  });
});
