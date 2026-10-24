import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ClosingRitualCard } from "../cards/special/ClosingRitualCard";
import { CrisisCard } from "../cards/special/CrisisCard";
import type { GuideCard } from "../contract/wire";
import { SpineList } from "../spine/JourneySpine";
import { buildSpineModel } from "../state/spineModel";
import { Composer, MESSAGE_MAX_CHARS, NextStepDock } from "../stage/ComposerArea";

describe("Composer", () => {
  it("sends on Enter, keeps a new line on Shift and Enter, and clears after sending", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const box = screen.getByLabelText("Message to Ally");

    fireEvent.change(box, { target: { value: "first line" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("first line");
    expect(box).toHaveValue("");
  });

  it("won't send blank text or while Ally is replying, but typing stays open", () => {
    const onSend = vi.fn();
    const { rerender } = render(<Composer onSend={onSend} />);
    const box = screen.getByLabelText("Message to Ally");
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();

    rerender(<Composer onSend={onSend} sendBlocked />);
    fireEvent.change(box, { target: { value: "hello" } });
    expect(box).not.toBeDisabled();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("counts down near the 2,000-character cap and blocks sending past it", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const box = screen.getByLabelText("Message to Ally");

    fireEvent.change(box, { target: { value: "a".repeat(MESSAGE_MAX_CHARS - 10) } });
    expect(screen.getByText("10 characters left")).toBeInTheDocument();

    fireEvent.change(box, { target: { value: "a".repeat(MESSAGE_MAX_CHARS + 1) } });
    expect(screen.getByText(/That's over 2,000 characters/)).toBeInTheDocument();
    expect(box).toHaveAttribute("aria-invalid", "true");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});

describe("NextStepDock", () => {
  it("names the next step and its time in one blue button", () => {
    const onContinue = vi.fn();
    render(
      <NextStepDock
        nextStep={{ hidden: false, itemId: "i2", title: "Reflecting feelings", minutes: 4 }}
        onContinue={onContinue}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Continue · Reflecting feelings · 4 min/ }));
    expect(onContinue).toHaveBeenCalled();
  });
});

const closingCard: GuideCard = {
  cardId: "k-close",
  kind: "closing_ritual",
  presentation: "inline",
  state: "ready",
  title: "Before you go",
  payload: {
    noticing: "Today you stayed with a long silence.",
    watchFor: "when a caller says “fine”",
    teaser: "Meera calls back.",
  },
};

describe("ClosingRitualCard", () => {
  // Wednesday 21 Oct 2026, 20:30.
  const now = () => new Date(2026, 9, 21, 20, 30);

  it("shows today's noticing, what to watch for, the time chips and the teaser", () => {
    render(
      <ClosingRitualCard
        card={closingCard}
        careMode={false}
        courseTitle="C"
        journeyUrl="u"
        onSchedule={vi.fn()}
        now={now}
      />,
    );
    expect(screen.getByText("Today you stayed with a long silence.")).toBeInTheDocument();
    expect(screen.getByText(/One thing to watch for next time/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tomorrow morning" })).toBeInTheDocument();
    expect(screen.getByText("Next time: Meera calls back.")).toBeInTheDocument();
  });

  it("saves tomorrow 9:00 in the learner's zone and confirms it", async () => {
    const onSchedule = vi.fn().mockResolvedValue(undefined);
    render(
      <ClosingRitualCard
        card={closingCard}
        careMode={false}
        courseTitle="C"
        journeyUrl="u"
        onSchedule={onSchedule}
        now={now}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow morning" }));
    await waitFor(() => expect(screen.getByText(/One reminder, then nothing/)).toBeInTheDocument());
    const [slot, at, zone] = onSchedule.mock.calls[0];
    expect(slot).toBe("tomorrowMorning");
    expect([at.getDate(), at.getHours()]).toEqual([22, 9]);
    expect(typeof zone).toBe("string");
  });

  it("asks once when the shift ends", () => {
    localStorage.removeItem("allyGuideShiftEnd");
    render(
      <ClosingRitualCard
        card={closingCard}
        careMode={false}
        courseTitle="C"
        journeyUrl="u"
        onSchedule={vi.fn()}
        now={now}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "After my shift" }));
    expect(screen.getByLabelText("When does your shift usually end?")).toBeInTheDocument();
  });

  it("says so kindly when it couldn't save", async () => {
    const onSchedule = vi.fn().mockRejectedValue(new Error("x"));
    render(
      <ClosingRitualCard
        card={closingCard}
        careMode={false}
        courseTitle="C"
        journeyUrl="u"
        onSchedule={onSchedule}
        now={now}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "This weekend" }));
    expect(await screen.findByText(/I couldn't save that time/)).toBeInTheDocument();
  });

  it("in CARE shows only the time row, with 'Whenever you're ready'", () => {
    render(
      <ClosingRitualCard
        card={closingCard}
        careMode
        courseTitle="C"
        journeyUrl="u"
        onSchedule={vi.fn()}
        now={now}
      />,
    );
    expect(screen.queryByText("Today you stayed with a long silence.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Next time/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Whenever you're ready" }));
    expect(screen.getByText(/The course will be here/)).toBeInTheDocument();
  });
});

describe("CrisisCard", () => {
  it("puts the fixed message first and focuses it, then one-tap call buttons", () => {
    render(
      <CrisisCard
        message="Fixed message."
        language="en"
        lines={[]}
        onSafe={vi.fn()}
        onNeedHelp={vi.fn()}
      />,
    );
    expect(screen.getByTestId("crisis-message")).toHaveFocus();
    const card = screen.getByTestId("crisis-card");
    expect(within(card).getByRole("link", { name: /Tele-MANAS 14416/ })).toHaveAttribute(
      "href",
      "tel:14416",
    );
    expect(within(card).getByRole("link", { name: /Emergency 112/ })).toHaveAttribute(
      "href",
      "tel:112",
    );
    expect(within(card).getByText(/1-800-891-4416/)).toBeInTheDocument();
    expect(within(card).getByText(/Nothing is shared with your organisation/)).toBeInTheDocument();
  });

  it("emphasises the numbers and adds the fixed lines after 'I need help now'", () => {
    const onNeedHelp = vi.fn();
    const { rerender } = render(
      <CrisisCard message="m" language="en" lines={[]} onSafe={vi.fn()} onNeedHelp={onNeedHelp} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "I need help now" }));
    expect(onNeedHelp).toHaveBeenCalled();
    rerender(
      <CrisisCard
        message="m"
        language="en"
        lines={[]}
        helpRequested
        onSafe={vi.fn()}
        onNeedHelp={onNeedHelp}
      />,
    );
    expect(screen.getByText(/this page will stay open/)).toBeInTheDocument();
  });

  it("shows only the numbers in reference mode (the Support chip)", () => {
    render(
      <CrisisCard
        language="en"
        lines={[{ name: "Org line", phone: "+91 98000 00000", hours: "9 to 5" }]}
        reference
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Org line/ })).toHaveAttribute(
      "href",
      "tel:+919800000000",
    );
  });
});

describe("Course map list", () => {
  it("marks the current item as the step and says each state in words", () => {
    const model = buildSpineModel({
      sections: [
        {
          id: "s1",
          title: "Opening",
          items: [
            {
              id: "a",
              type: "ARTICLE",
              title: "Done one",
              state: "done",
              minutes: 4,
              boss: false,
              tension: "low",
              hasWarnings: false,
            },
            {
              id: "b",
              type: "QUIZ",
              title: "Current one",
              state: "available",
              minutes: 3,
              boss: false,
              tension: "medium",
              hasWarnings: false,
            },
            {
              id: "c",
              type: "ROLEPLAY",
              title: "Later one",
              state: "locked",
              minutes: 10,
              boss: true,
              tension: "high",
              hasWarnings: false,
            },
          ],
        },
      ],
    });
    const onSelect = vi.fn();
    render(<SpineList model={model} onSelect={onSelect} />);
    const current = screen.getByRole("button", { name: /Current one/ });
    expect(current).toHaveAttribute("aria-current", "step");
    expect(current).toHaveTextContent("You are here");
    expect(screen.getByRole("button", { name: /Done one/ })).toHaveTextContent("Done");
    expect(screen.getByRole("button", { name: /Later one/ })).toHaveTextContent("Locked");
    fireEvent.click(screen.getByRole("button", { name: /Later one/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "c", state: "locked" }));
  });
});
