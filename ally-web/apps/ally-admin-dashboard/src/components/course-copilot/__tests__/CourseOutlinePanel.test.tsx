import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CourseChangeLogEntry,
  CourseOutline,
  CourseOutlineItem,
  CoursePublishReadiness,
} from "@types";

// @constants reads off the @components barrel at module-eval time (see the Builder
// tests), so the barrel is stubbed rather than loaded for real.
vi.mock("@components", () => ({ cellTypes: {} }));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: any) => <>{children}</>,
  // The real renderer sanitises with DOMPurify; what matters here is that the description is
  // handed to it rather than injected by this component.
  RichTextRenderer: ({ content }: any) => <div data-testid="description">{content}</div>,
}));

// eslint-disable-next-line import/first
import { CourseOutlinePanel, CourseOutlinePanelProps } from "../CourseOutlinePanel";
// eslint-disable-next-line import/first
import { outline } from "./fixtures";

const NOW = new Date("2026-10-14T10:00:00Z");

const outlineItem = (overrides: Partial<CourseOutlineItem> & Pick<CourseOutlineItem, "id" | "type" | "preview">): CourseOutlineItem => ({
  order: 1,
  title: overrides.id,
  size: "",
  ...overrides,
});

const fullOutline = (): CourseOutline =>
  outline({
    sections: [
      {
        id: "s1",
        order: 1,
        title: "Foundations",
        description: "The core ideas",
        items: [
          outlineItem({
            id: "article",
            type: "ARTICLE",
            title: "What listening is",
            size: "820 words, 2 checks",
            preview: {
              type: "ARTICLE",
              excerpt: "Listening is more than hearing the words.",
              wordCount: 820,
              questionCount: 2,
              resourceCount: 1,
              imageUrls: ["https://img.test/one.png", "https://img.test/two.png"],
            },
          }),
          outlineItem({
            id: "quiz",
            type: "QUIZ",
            title: "Check your understanding",
            size: "6 questions",
            completionCriteria: { passScore: 70 },
            preview: {
              type: "QUIZ",
              questionCount: 6,
              passScore: 70,
              sampleQuestion: "What does reflecting a feeling show?",
              questionTypes: ["mcq_single", "open_ended"],
            },
          }),
          outlineItem({
            id: "journal",
            type: "JOURNAL",
            title: "Reflect",
            preview: {
              type: "JOURNAL",
              prompts: ["Prompt one", "Prompt two", "Prompt three", "Prompt four"],
            },
          }),
          outlineItem({
            id: "annotation",
            type: "ANNOTATED_ARTIFACT",
            title: "Mark up a call",
            preview: {
              type: "ANNOTATED_ARTIFACT",
              unitCount: 12,
              labels: ["Reflection", "Open question"],
              targetCount: 5,
              intro: "Read the transcript and label each helper turn.",
            },
          }),
        ],
      },
      {
        id: "s2",
        order: 2,
        title: "Practice",
        items: [
          outlineItem({
            id: "roleplay",
            type: "ROLEPLAY",
            title: "A hard first call",
            preview: {
              type: "ROLEPLAY",
              scenarioId: 12,
              scenarioTitle: "Anxious first-time caller",
              coverImageUrl: "https://img.test/persona.png",
              generated: true,
            },
          }),
          outlineItem({
            id: "case",
            type: "CASE",
            title: "Crisis call",
            preview: { type: "CASE", caseId: "c1", caseTitle: "A night shift", roleplayCount: 3, generated: false },
          }),
          outlineItem({
            id: "game",
            type: "GAME",
            title: "Take a break",
            preview: { type: "GAME", gameKey: "MEMORY_MATCH", intro: "Match the helping skills." },
          }),
          outlineItem({
            id: "video",
            type: "VIDEO",
            title: "Watch a real call",
            preview: { type: "VIDEO", source: "youtube", url: "https://youtu.be/abc123" },
          }),
          outlineItem({
            id: "video-empty",
            type: "VIDEO",
            title: "Another video",
            preview: { type: "VIDEO", source: null, url: null },
          }),
        ],
      },
    ],
  });

const card = (id: string) => document.querySelector(`[data-item-id="${id}"]`) as HTMLElement;

const setup = (overrides: Partial<CourseOutlinePanelProps> = {}) => {
  const props: CourseOutlinePanelProps = {
    outline: fullOutline(),
    onOpenEditor: vi.fn(),
    ...overrides,
  };
  return { ...render(<CourseOutlinePanel {...props} />), props };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CourseOutlinePanel — preview cards", () => {
  it("shows an article's excerpt, counts and first image", () => {
    setup();
    const article = card("article");

    expect(within(article).getByText("Listening is more than hearing the words.")).toBeInTheDocument();
    // The counts appear once, next to the excerpt — not again as the header's size string.
    expect(within(article).queryByText("820 words, 2 checks")).toBeNull();
    expect(within(article).getByText("820 words")).toBeInTheDocument();
    expect(within(article).getByText("2 checks")).toBeInTheDocument();
    expect(within(article).getByText("1 resource")).toBeInTheDocument();
    expect(article.querySelector("img")).toHaveAttribute("src", "https://img.test/one.png");
    expect(within(article).getByText("+1 more image")).toBeInTheDocument();
    expect(within(article).getByText("Article")).toBeInTheDocument();
  });

  it("shows a quiz's question count, pass mark, question types and a sample question", () => {
    setup();
    const quiz = card("quiz");

    expect(within(quiz).getByText("6 questions")).toBeInTheDocument();
    expect(within(quiz).getAllByText("Pass mark 70").length).toBeGreaterThan(0);
    expect(within(quiz).getByText("Multiple choice")).toBeInTheDocument();
    expect(within(quiz).getByText("Open-ended")).toBeInTheDocument();
    expect(within(quiz).getByText("What does reflecting a feeling show?")).toBeInTheDocument();
  });

  it("shows the first few journal prompts and counts the rest", () => {
    setup();
    const journal = card("journal");

    expect(within(journal).getByText("Prompt one")).toBeInTheDocument();
    expect(within(journal).getByText("Prompt three")).toBeInTheDocument();
    expect(within(journal).queryByText("Prompt four")).toBeNull();
    expect(within(journal).getByText("+1 more prompt")).toBeInTheDocument();
  });

  it("shows an annotation's lines, labels and targets", () => {
    setup();
    const annotation = card("annotation");

    expect(within(annotation).getByText("12 lines")).toBeInTheDocument();
    expect(within(annotation).getByText("5 targets")).toBeInTheDocument();
    expect(within(annotation).getByText("Reflection")).toBeInTheDocument();
    expect(within(annotation).getByText("Open question")).toBeInTheDocument();
  });

  it("shows a roleplay's scenario, cover and Generated badge, linking to the simulation", () => {
    setup();
    const roleplay = card("roleplay");

    expect(within(roleplay).getByText("Anxious first-time caller")).toBeInTheDocument();
    expect(within(roleplay).getByText("Generated")).toBeInTheDocument();
    expect(roleplay.querySelector("img")).toHaveAttribute("src", "https://img.test/persona.png");
    expect(within(roleplay).getByRole("link", { name: /Open roleplay/ })).toHaveAttribute(
      "href",
      "/create-simulation/edit/12",
    );
  });

  it("shows a case's title and roleplay count, without a Generated badge when it is from the library", () => {
    setup();
    const caseCard = card("case");

    expect(within(caseCard).getByText("A night shift")).toBeInTheDocument();
    expect(within(caseCard).getByText("3 roleplays")).toBeInTheDocument();
    expect(within(caseCard).queryByText("Generated")).toBeNull();
  });

  it("shows a game by name", () => {
    setup();
    expect(within(card("game")).getByText("Memory Match")).toBeInTheDocument();
    expect(within(card("game")).getByText("Match the helping skills.")).toBeInTheDocument();
  });

  it("shows a video's player and link, or that it still needs one", () => {
    setup();

    expect(within(card("video")).getByText("YouTube")).toBeInTheDocument();
    expect(within(card("video")).getByRole("link", { name: "https://youtu.be/abc123" })).toHaveAttribute(
      "href",
      "https://youtu.be/abc123",
    );
    expect(within(card("video-empty")).getByText("Needs a video link")).toBeInTheDocument();
  });

  it("never makes a non-http(s) video URL clickable", () => {
    setup({
      outline: outline({
        sections: [
          {
            id: "s1",
            order: 1,
            title: "S",
            items: [
              outlineItem({
                id: "evil",
                type: "VIDEO",
                title: "Evil",
                preview: { type: "VIDEO", source: "youtube", url: "javascript:alert(1)" },
              }),
            ],
          },
        ],
      }),
    });

    expect(within(card("evil")).getByText("javascript:alert(1)")).toBeInTheDocument();
    expect(within(card("evil")).queryByRole("link")).toBeNull();
  });

  it("shows a completion rule under the title", () => {
    setup();
    expect(within(card("quiz")).getAllByText("Pass mark 70").length).toBeGreaterThan(0);
  });

  it("renders a card as just its header when it has nothing to say, without an empty frame", () => {
    setup({
      outline: outline({
        sections: [
          {
            id: "s1",
            order: 1,
            title: "S",
            items: [outlineItem({ id: "bare", type: "JOURNAL", title: "Bare", preview: { type: "JOURNAL", prompts: [] } })],
          },
        ],
      }),
    });
    expect(card("bare").querySelector(".mt-2")?.textContent ?? "").toBe("");
  });

  it("survives previews the agent mangled: a string where a list belongs, a missing preview", () => {
    setup({
      outline: outline({
        sections: [
          {
            id: "s1",
            order: 1,
            title: "S",
            items: [
              outlineItem({
                id: "bad-article",
                type: "ARTICLE",
                title: "Bad article",
                preview: { type: "ARTICLE", excerpt: null, wordCount: "lots", questionCount: 0, resourceCount: 0, imageUrls: "not a list" } as never,
              }),
              outlineItem({ id: "no-preview", type: "QUIZ", title: "No preview", preview: undefined as never }),
              outlineItem({
                id: "bad-quiz",
                type: "QUIZ",
                title: "Bad quiz",
                preview: { type: "QUIZ", questionCount: 1, passScore: null, sampleQuestion: null, questionTypes: "mcq" } as never,
              }),
            ],
          },
        ],
      }),
    });

    expect(screen.getByText("Bad article")).toBeInTheDocument();
    expect(screen.getByText("No preview")).toBeInTheDocument();
    expect(screen.getByText("1 question")).toBeInTheDocument();
  });

  it("survives sections that are not a list", () => {
    setup({ outline: { ...fullOutline(), sections: "nope" as never } });
    expect(screen.getByText("This course has no sections yet.")).toBeInTheDocument();
  });
});

describe("CourseOutlinePanel — meta", () => {
  it("shows a placeholder when there is no cover, and the cover when there is one", () => {
    const { unmount } = setup();
    expect(screen.getByText("No cover yet")).toBeInTheDocument();
    unmount();

    setup({ outline: { ...fullOutline(), coverImageUrl: "https://img.test/cover.png" } });
    expect(screen.queryByText("No cover yet")).toBeNull();
    expect(document.querySelector('img[src="https://img.test/cover.png"]')).not.toBeNull();
  });

  it("hands the description to the sanitising renderer rather than injecting it", () => {
    setup({ outline: { ...fullOutline(), description: "<p>One</p><p>Two<br>three</p>" } });
    expect(screen.getByTestId("description")).toHaveTextContent("<p>One</p><p>Two<br>three</p>");
  });

  it("shows duration, status, and the structure lock", () => {
    setup({ outline: { ...fullOutline(), status: "ACTIVE", structureLocked: true } });

    expect(screen.getByText("About 36 min")).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByText("Structure locked — learners are enrolled")).toBeInTheDocument();
  });

  it("shows no lock note on an unlocked course", () => {
    setup();
    expect(screen.queryByText(/Structure locked/)).toBeNull();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("opens the editor", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));
    expect(props.onOpenEditor).toHaveBeenCalledTimes(1);
  });

  it("disables Open in editor with a reason while the copilot is building", () => {
    const { props } = setup({
      openEditorDisabledReason:
        "Wait for the build to finish — the copilot overwrites edits made during the build.",
    });
    const button = screen.getByRole("button", { name: "Open in editor" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(props.onOpenEditor).not.toHaveBeenCalled();
  });

  it("explains itself when there is no outline yet", () => {
    setup({ outline: null });
    expect(screen.getByText("The course outline will appear here once it has been written.")).toBeInTheDocument();
  });
});

describe("CourseOutlinePanel — publish readiness", () => {
  const notReady: CoursePublishReadiness = {
    ready: false,
    checks: [
      { key: "title", label: "Title", ok: true },
      {
        key: "cover",
        label: "Cover image",
        ok: false,
        detail: "Cover image needed — pick one from the library or upload",
      },
      { key: "sections", label: "Every section has an item", ok: false },
    ],
  };

  it("heads the checklist 'Ready to publish' when it is", () => {
    setup({
      readiness: { ready: true, checks: [{ key: "title", label: "Title", ok: true }] },
    });
    expect(screen.getByRole("heading", { name: "Ready to publish" })).toBeInTheDocument();
  });

  it("heads it 'Needs: …' with what is missing, and lists every check with its detail", () => {
    setup({ readiness: notReady });

    expect(
      screen.getByRole("heading", { name: "Needs: Cover image, Every section has an item" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Cover image needed — pick one from the library or upload")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").some(entry => entry.textContent?.startsWith("Title"))).toBe(true);
  });

  it("offers to hand an unmet check to the copilot only when it can act", () => {
    const onAskCopilot = vi.fn();
    const { unmount } = setup({ readiness: notReady });
    expect(screen.queryByRole("button", { name: "Ask the copilot" })).toBeNull();
    unmount();

    setup({ readiness: notReady, onAskCopilot });
    const buttons = screen.getAllByRole("button", { name: "Ask the copilot" });
    // One per unmet check — never for one that is already met.
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);
    expect(onAskCopilot).toHaveBeenCalledWith(notReady.checks[1]);
  });

  it("renders nothing for a missing checklist", () => {
    setup({ readiness: null });
    expect(screen.queryByText(/Ready to publish|Needs:/)).toBeNull();
  });
});

describe("CourseOutlinePanel — change log", () => {
  const entry = (at: string, summary: string): CourseChangeLogEntry => ({ at, summary, tool: "update_section" });

  it("lists changes newest first with a relative time", () => {
    setup({
      changeLog: [
        entry("2026-10-14T09:00:00Z", "Renamed section 2"),
        entry("2026-10-14T09:55:00Z", "Shortened the quiz"),
        entry("2026-10-14T09:30:00Z", "Added a journal"),
      ],
    });

    const log = screen.getByRole("region", { name: "What the copilot changed" });
    const rows = within(log).getAllByRole("listitem").map(row => row.textContent);
    expect(rows).toEqual([
      "5m agoShortened the quiz",
      "30m agoAdded a journal",
      "1h agoRenamed section 2",
    ]);
  });

  it("collapses a long log behind 'Show more'", () => {
    setup({
      changeLog: Array.from({ length: 11 }, (_, index) =>
        entry(`2026-10-14T09:${String(10 + index).padStart(2, "0")}:00Z`, `Change ${index + 1}`),
      ),
    });

    const log = screen.getByRole("region", { name: "What the copilot changed" });
    expect(within(log).getAllByRole("listitem")).toHaveLength(8);
    fireEvent.click(within(log).getByRole("button", { name: "Show 3 more" }));
    expect(within(log).getAllByRole("listitem")).toHaveLength(11);
  });

  it("renders nothing at all for an empty or malformed log", () => {
    const { unmount } = setup({ changeLog: [] });
    expect(screen.queryByText("What the copilot changed")).toBeNull();
    unmount();

    setup({ changeLog: "nope" as never });
    expect(screen.queryByText("What the copilot changed")).toBeNull();
  });
});

describe("CourseOutlinePanel — highlighting what the copilot just changed", () => {
  it("highlights a flashed item, then lets it go", () => {
    setup({ flashItemIds: ["quiz"] });

    expect(card("quiz")).toHaveAttribute("data-flash", "true");
    expect(card("article")).not.toHaveAttribute("data-flash");

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(card("quiz")).not.toHaveAttribute("data-flash");
  });

  it("highlights again when a new batch names the same item", () => {
    const { rerender, props } = setup({ flashItemIds: ["quiz"] });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(card("quiz")).not.toHaveAttribute("data-flash");

    // A second copilot edit to the same item arrives as a new array.
    rerender(<CourseOutlinePanel {...props} flashItemIds={["quiz"]} />);
    expect(card("quiz")).toHaveAttribute("data-flash", "true");
  });

  it("highlights an item that is flashed after the first render", () => {
    const { rerender, props } = setup();
    expect(card("quiz")).not.toHaveAttribute("data-flash");

    rerender(<CourseOutlinePanel {...props} flashItemIds={["quiz"]} />);
    expect(card("quiz")).toHaveAttribute("data-flash", "true");
  });
});

describe("CourseOutlinePanel — compact", () => {
  it("shows one line per item and none of the checklist, change log or previews", () => {
    setup({
      compact: true,
      readiness: { ready: true, checks: [{ key: "t", label: "Title", ok: true }] },
      changeLog: [{ at: "2026-10-14T09:55:00Z", summary: "Shortened the quiz", tool: "x" }],
    });

    expect(screen.getByText("What listening is")).toBeInTheDocument();
    expect(screen.getByText("820 words, 2 checks")).toBeInTheDocument();
    expect(screen.queryByText("Listening is more than hearing the words.")).toBeNull();
    expect(screen.queryByText("Ready to publish")).toBeNull();
    expect(screen.queryByText("Shortened the quiz")).toBeNull();
  });
});
