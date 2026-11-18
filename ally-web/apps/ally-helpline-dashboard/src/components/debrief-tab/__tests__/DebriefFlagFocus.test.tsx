import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CardFlag } from "../DebriefCardFeedback";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@api", () => ({
  useFlagDebriefCardMutation: () => [vi.fn(), { isLoading: false }],
  useUndoDebriefFlagMutation: () => [vi.fn(), { isLoading: false }],
  useSetDebriefHelpfulMutation: () => [vi.fn(), { isLoading: false }],
  useAnswerDebriefPulseMutation: () => [vi.fn(), { isLoading: false }],
}));

/** PRD §9: the flag sheet traps focus, closes on Esc and hands focus back. */
describe("CardFlag focus", () => {
  it("keeps Tab inside the sheet and returns focus to the opener on Esc", () => {
    render(<CardFlag sessionId="s-1" section="work_on_this[0]" cardLabel="Work on this" />);
    const opener = screen.getByRole("button", { name: "postSim.debriefCards.flag.openLabel" });
    fireEvent.click(opener);
    const form = screen.getByTestId("debrief-flag-form");
    const cancel = screen.getByRole("button", { name: "postSim.debriefCards.flag.cancel" });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(document.activeElement).toHaveAttribute("value", "didnt_say");
    fireEvent.keyDown(document.activeElement as Element, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(form, { key: "Escape" });
    expect(screen.queryByTestId("debrief-flag-form")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "postSim.debriefCards.flag.openLabel" }),
    );
  });
});
