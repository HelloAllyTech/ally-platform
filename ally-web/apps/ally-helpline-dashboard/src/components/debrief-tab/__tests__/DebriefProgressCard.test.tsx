import { fireEvent, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { describe, expect, it } from "vitest";

import en from "../../../i18n/locales/en.json";
import { DebriefProgressCard, parseProgressCard } from "../DebriefProgressCard";

const renderCard = async (raw: unknown) => {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
  const card = parseProgressCard(raw);
  return render(
    <I18nextProvider i18n={i18n}>{card && <DebriefProgressCard card={card} />}</I18nextProvider>,
  );
};

const progressCard = {
  sessions: 5,
  skills: [
    {
      skill: "empathy",
      trend: "more_consistent",
      line: "You named the feeling in 4 of 5 sessions.",
    },
    {
      skill: "open_questions",
      trend: "about_the_same",
      line: "About half your questions were open.",
    },
    { skill: "harm", trend: "too_early", line: "It came up in only 2 sessions." },
  ],
  focus: { skill: "harm", line: "Ask about safety directly." },
};

/** Progress contract §4: the learner's "Your last {n} sessions" card. */
describe("DebriefProgressCard", () => {
  it("renders nothing when the debrief has no progress card", async () => {
    await renderCard(undefined);
    expect(screen.queryByTestId("debrief-card-progress")).not.toBeInTheDocument();
  });

  it("is collapsed by default, showing the title and the focus line", async () => {
    await renderCard(progressCard);
    const card = screen.getByTestId("debrief-card-progress");
    expect(within(card).getByRole("heading", { level: 3 })).toHaveTextContent(
      "Your last 5 sessions",
    );
    expect(within(card).getByTestId("debrief-progress-focus")).toHaveTextContent(
      "One focus for your next sessions: Ask about safety",
    );
    expect(within(card).getByText("Ask about safety directly.")).toBeVisible();
    const toggle = within(card).getByRole("button", { name: /show more/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(card).getByTestId("debrief-progress-skills")).not.toBeVisible();
  });

  it("expands to every skill line with its trend word, and collapses again", async () => {
    await renderCard(progressCard);
    fireEvent.click(screen.getByRole("button", { name: /show more/i }));
    const toggle = screen.getByRole("button", { name: /show less/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const skills = screen.getByTestId("debrief-progress-skills");
    expect(skills).toBeVisible();
    expect(toggle).toHaveAttribute("aria-controls", skills.id);
    const items = within(skills).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    // Known skills use the app's own names; unknown keys are made readable.
    expect(items[0]).toHaveTextContent("Show empathy");
    expect(items[0]).toHaveTextContent("Getting more consistent");
    expect(items[0]).toHaveTextContent("You named the feeling in 4 of 5 sessions.");
    expect(items[1]).toHaveTextContent("Open questions");
    expect(items[1]).toHaveTextContent("About the same");
    expect(items[2]).toHaveTextContent("Too early to tell");

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: /show more/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(skills).not.toBeVisible();
  });

  it("shows the first skill line when there is no focus", async () => {
    await renderCard({ ...progressCard, focus: null });
    expect(screen.queryByTestId("debrief-progress-focus")).not.toBeInTheDocument();
    expect(screen.getByTestId("debrief-progress-preview")).toHaveTextContent(
      "You named the feeling in 4 of 5 sessions.",
    );
  });

  it("renders nothing for a malformed card", async () => {
    for (const raw of [
      null,
      "card",
      [],
      { skills: progressCard.skills, focus: progressCard.focus }, // no sessions
      { sessions: "5", skills: progressCard.skills, focus: null },
      { sessions: 5, skills: "lots", focus: "harm" }, // nothing readable
      { sessions: 5, skills: [{ skill: "empathy", trend: "better", line: "x" }], focus: null },
      {
        sessions: 5,
        skills: [{ skill: "empathy", trend: "about_the_same", line: " " }],
        focus: {},
      },
    ]) {
      const { unmount } = await renderCard(raw);
      expect(screen.queryByTestId("debrief-card-progress")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("drops malformed skills but keeps the rest", () => {
    expect(
      parseProgressCard({
        sessions: 6,
        skills: [
          null,
          { skill: "empathy", trend: "worth_another_look", line: "Try naming it." },
          { skill: "hope", trend: "nope", line: "x" },
          { skill: "", trend: "too_early", line: "x" },
        ],
        focus: { skill: "hope" },
      }),
    ).toEqual({
      sessions: 6,
      skills: [{ skill: "empathy", trend: "worth_another_look", line: "Try naming it." }],
      focus: null,
    });
  });
});
