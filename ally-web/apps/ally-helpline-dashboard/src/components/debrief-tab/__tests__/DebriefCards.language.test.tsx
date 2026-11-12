import { render, screen } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next, useTranslation } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

import { DebriefCards, isIndicLanguage } from "../DebriefCards";

vi.mock("../useDebriefReadAloud", () => ({ useDebriefReadAloud: () => null }));
vi.mock("@api", () => ({
  useReportDebriefEventMutation: () => [vi.fn(() => ({ unwrap: () => Promise.resolve() }))],
  useMarkDebriefOpenedMutation: () => [vi.fn()],
  useMarkDebriefReadMutation: () => [vi.fn()],
  useSetDebriefHelpfulMutation: () => [vi.fn(), { isLoading: false }],
  useAnswerDebriefPulseMutation: () => [vi.fn(), { isLoading: false }],
  useFlagDebriefCardMutation: () => [vi.fn(), { isLoading: false }],
  useUndoDebriefFlagMutation: () => [vi.fn(), { isLoading: false }],
  useLazyGetDebriefCardAudioQuery: () => [vi.fn()],
}));

/**
 * PRD §9: everything in the debrief follows the session's language — a Hindi
 * session read in the English app gets Hindi labels.
 */
describe("DebriefCards language", () => {
  it("labels a Hindi debrief in Hindi inside an English app", async () => {
    const i18n = i18next.createInstance();
    await i18n.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: {
        en: { translation: { postSim: { debriefCards: { header: "Your debrief" } } } },
        hi: { translation: { postSim: { debriefCards: { header: "आपका डीब्रीफ़" } } } },
      },
    });
    const AppLabel = () => (
      <span data-testid="app">{useTranslation().t("postSim.debriefCards.header")}</span>
    );
    render(
      <I18nextProvider i18n={i18n}>
        <AppLabel />
        <DebriefCards
          view={{ state: "working", steps: [], language: "hi-IN" }}
          sessionId="s-1"
          supervisor={{}}
        />
      </I18nextProvider>,
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("आपका डीब्रीफ़");
    // The rest of the app stays in the app's language, and so does the
    // language the app remembers.
    expect(screen.getByTestId("app")).toHaveTextContent("Your debrief");
    expect(i18n.language).toBe("en");
  });

  it("a reply thread rendered inside the cards reads the debrief's language too", async () => {
    const i18n = i18next.createInstance();
    await i18n.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: {
        en: {
          translation: {
            postSim: {
              debriefCards: {
                supervisor: { canRead: "Your supervisor can read this conversation." },
              },
            },
          },
        },
        hi: {
          translation: {
            postSim: {
              debriefCards: { supervisor: { canRead: "आपके सुपरवाइज़र यह बातचीत पढ़ सकते हैं।" } },
            },
          },
        },
      },
    });
    const Note = () => (
      <p data-testid="note">{useTranslation().t("postSim.debriefCards.supervisor.canRead")}</p>
    );
    render(
      <I18nextProvider i18n={i18n}>
        <DebriefCards
          view={
            {
              state: "ready",
              language: "hi-IN",
              cards: {
                opening: "ठीक",
                what_worked: [],
                work_on_this: [],
                skill_words: [],
                reflective_question: "",
              },
            } as never
          }
          sessionId="s-1"
          replyThread={<Note />}
        />
      </I18nextProvider>,
    );
    expect(screen.getByTestId("note")).toHaveTextContent("आपके सुपरवाइज़र");
    // A short debrief without a question: no empty question card, Ask Ally stays.
    expect(screen.queryByTestId("debrief-card-reflective-question")).toBeNull();
    expect(screen.getByTestId("debrief-ask-ally-no-question")).toContainElement(
      screen.getByTestId("note"),
    );
  });

  it("knows which scripts need the taller line height", () => {
    expect(isIndicLanguage("hi-IN")).toBe(true);
    expect(isIndicLanguage("ta")).toBe(true);
    expect(isIndicLanguage("en-IN")).toBe(false);
    expect(isIndicLanguage(null)).toBe(false);
  });
});
