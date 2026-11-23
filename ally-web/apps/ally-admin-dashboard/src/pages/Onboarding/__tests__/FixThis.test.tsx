import React from "react";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@constants";

const h = vi.hoisted(() => ({
  run: vi.fn(),
  cancel: vi.fn(),
  fallback: vi.fn(),
  addCase: vi.fn(),
}));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTestBotDraftMutation: () => [h.fallback],
  useAddCheckupCaseMutation: () => [h.addCase],
}));
vi.mock("@hooks/useChatbotTestStream", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useChatbotTestStream: () => ({ run: h.run, cancel: h.cancel }),
}));

// eslint-disable-next-line import/first
import { SPLIT_COPY } from "../copy";
// eslint-disable-next-line import/first
import { DraftTestPane } from "../DraftTestPane";
// eslint-disable-next-line import/first
import {
  FIX_THIS_PATHS,
  addFactPatch,
  avoidTopicPatch,
  closestFacts,
  correctFactPatch,
  isAllowedFixPatch,
  tonePatch,
} from "../fixPatches";

const T = SPLIT_COPY.pane;
const F = SPLIT_COPY.fix;
const A = SPLIT_COPY.addFact;
const S = SPLIT_COPY.saveTest;
const U = SPLIT_COPY.unanswered;

const facts = [
  { id: "f1", section: "about", text: "We are open on weekdays.", sourceUrl: "https://x.test" },
  { id: "f2", section: "services", text: "A haircut costs ten dollars.", sourceUrl: "owner" },
  { id: "f3", section: "faqs", text: "Parking is free.", sourceUrl: "https://x.test" },
  { id: "f4", section: "team", text: "Sam runs the shop.", sourceUrl: "https://x.test" },
];

const view = (over: Record<string, unknown> = {}) =>
  ({
    id: "d1",
    status: "active",
    version: 1,
    chatbotId: "b1",
    learned: { facts, dropped: 0 },
    draft: { assistantName: "Sunny", introduction: "Hi", suggestedQuestions: [], extraNever: [] },
    ...over,
  }) as never;

const reply = (text: string, over: Record<string, unknown> = {}) => ({
  reply: text,
  handledBy: "rag",
  citations: [],
  latencyMs: 1000,
  conversationId: "c1",
  preview: { pendingDocuments: 0 },
  wouldFileUnanswered: null,
  ...over,
});
const declined = (text = "I don't know.") =>
  reply(text, { handledBy: "declined", wouldFileUnanswered: { reason: "no_answer" } });

const tools = () => ({
  edit: vi.fn().mockResolvedValue(true),
  upload: vi.fn().mockResolvedValue(true),
});

const ask = async (text: string) => {
  fireEvent.change(screen.getByLabelText(T.inputLabel), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: T.send }));
  });
};

const openFix = async (choiceLabel: string) => {
  fireEvent.click(screen.getByRole("button", { name: F.button }));
  const panel = screen.getByRole("region", { name: F.panel });
  expect(panel).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: choiceLabel }));
};

beforeEach(() => {
  h.run.mockReset();
  h.cancel.mockReset();
  h.fallback.mockReset();
  h.addCase.mockReset();
});

describe("FIX_THIS_PATHS", () => {
  it("allows only facts add or replace-text, extra rules and tone", () => {
    expect(FIX_THIS_PATHS.map(p => `${p.target} ${p.op} ${p.path}`)).toEqual([
      "learned add /facts/-",
      "learned replace /facts/{n}/text",
      "draft add /extraNever/-",
      "draft replace /tone",
    ]);
  });

  it("every patch the flows build is within it, and others are refused", () => {
    const built = [
      correctFactPatch(2, "x"),
      addFactPatch("q", "a"),
      avoidTopicPatch("politics"),
      tonePatch("formal"),
    ];
    built.forEach(p => expect(isAllowedFixPatch(p.target, p.ops)).toBe(true));
    for (const path of ["/safetyPackId", "/knowledgeDocumentIds", "/access", "/facts/1"]) {
      expect(isAllowedFixPatch("draft", [{ op: "replace", path, value: 1 }])).toBe(false);
    }
    expect(isAllowedFixPatch("draft", [{ op: "add", path: "/facts/-", value: 1 }])).toBe(false);
    expect(isAllowedFixPatch("draft", [])).toBe(false);
  });

  it("ranks facts by shared words, else the 3 most recent", () => {
    expect(closestFacts("How much is a haircut?", facts as never)[0].fact.id).toBe("f2");
    expect(closestFacts("zzz qqq", facts as never).map(f => f.fact.id)).toEqual(["f4", "f3", "f2"]);
    expect(closestFacts("What is the cost of a haircut", facts as never)).toHaveLength(1);
  });
});

describe("Fix this", () => {
  it("is off without tools", async () => {
    h.run.mockResolvedValue(reply("Ten."));
    render(<DraftTestPane draftId="d1" view={view()} />);
    await ask("hi");
    await screen.findByText("Ten.");
    expect(screen.queryByRole("button", { name: F.button })).toBeNull();
  });

  it("corrects a fact: patches its text, closes, and asks again", async () => {
    const t = tools();
    h.run.mockResolvedValueOnce(reply("Five dollars."));
    render(<DraftTestPane draftId="d1" view={view()} fix={t} />);
    await ask("How much is a haircut?");
    await screen.findByText("Five dollars.");
    await openFix(F.correct);
    fireEvent.click(screen.getByRole("radio", { name: "A haircut costs ten dollars." }));
    const box = screen.getByLabelText(F.factEdit) as HTMLTextAreaElement;
    expect(box.value).toBe("A haircut costs ten dollars.");
    fireEvent.change(box, { target: { value: "A haircut costs twelve dollars." } });
    h.run.mockResolvedValueOnce(reply("Twelve dollars."));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: F.save }));
    });
    expect(t.edit).toHaveBeenCalledWith("learned", [
      { op: "replace", path: "/facts/1/text", value: "A haircut costs twelve dollars." },
    ]);
    await screen.findByText("Twelve dollars.");
    expect(screen.getByText(F.done)).toBeTruthy();
    expect(screen.queryByRole("region", { name: F.panel })).toBeNull();
    expect(h.run.mock.calls[1][0]).toMatchObject({ message: "How much is a haircut?" });
    expect((screen.getByText("Five dollars.").closest("li") as HTMLElement).className).toContain(
      "is-faded",
    );
  });

  it("keeps the text and the panel when the save fails", async () => {
    const t = tools();
    t.edit.mockResolvedValue(false);
    h.run.mockResolvedValueOnce(reply("Five dollars."));
    render(<DraftTestPane draftId="d1" view={view()} fix={t} />);
    await ask("How much is a haircut?");
    await screen.findByText("Five dollars.");
    await openFix(F.correct);
    fireEvent.click(screen.getByRole("radio", { name: "A haircut costs ten dollars." }));
    fireEvent.change(screen.getByLabelText(F.factEdit), { target: { value: "Edited" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: F.save }));
    });
    expect(screen.getByText(F.failed)).toBeTruthy();
    expect((screen.getByLabelText(F.factEdit) as HTMLTextAreaElement).value).toBe("Edited");
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it("adds a topic to avoid as an owner rule", async () => {
    const t = tools();
    h.run.mockResolvedValueOnce(reply("Politics.")).mockResolvedValueOnce(reply("No."));
    render(<DraftTestPane draftId="d1" view={view()} fix={t} />);
    await ask("Who should I vote for?");
    await screen.findByText("Politics.");
    await openFix(F.avoid);
    fireEvent.change(screen.getByLabelText(F.avoidLabel), { target: { value: "politics" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: F.save }));
    });
    expect(t.edit).toHaveBeenCalledWith("draft", [
      { op: "add", path: "/extraNever/-", value: "Don't talk about politics." },
    ]);
    await screen.findByText("No.");
    expect(h.run).toHaveBeenCalledTimes(2);
  });

  it("says so when the rules are full", async () => {
    const t = tools();
    h.run.mockResolvedValueOnce(reply("Politics."));
    const full = view({
      draft: { suggestedQuestions: [], extraNever: Array.from({ length: 20 }, (_, i) => `r${i}`) },
    });
    render(<DraftTestPane draftId="d1" view={full} fix={t} />);
    await ask("q");
    await screen.findByText("Politics.");
    await openFix(F.avoid);
    expect(screen.getByText(/20 rules/)).toBeTruthy();
    expect((screen.getByRole("button", { name: F.save }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("changes the tone using MakeItYours' tones", async () => {
    const t = tools();
    h.run.mockResolvedValueOnce(reply("Hey.")).mockResolvedValueOnce(reply("Hello."));
    render(<DraftTestPane draftId="d1" view={view()} fix={t} />);
    await ask("q");
    await screen.findByText("Hey.");
    await openFix(F.tone);
    fireEvent.click(screen.getByRole("radio", { name: "Formal" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: F.save }));
    });
    expect(t.edit).toHaveBeenCalledWith("draft", [
      { op: "replace", path: "/tone", value: "formal" },
    ]);
    await screen.findByText("Hello.");
  });

  it("adds a missing page from a file, reusing upload", async () => {
    const t = tools();
    h.run.mockResolvedValueOnce(reply("Hmm.")).mockResolvedValueOnce(reply("Now."));
    render(<DraftTestPane draftId="d1" view={view()} fix={t} />);
    await ask("q");
    await screen.findByText("Hmm.");
    await openFix(F.page);
    const file = new File(["x"], "menu.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(screen.getByTestId("fix-page-file"), { target: { files: [file] } });
    });
    expect(t.upload).toHaveBeenCalledWith([file]);
    expect(t.edit).not.toHaveBeenCalled();
    await screen.findByText("Now.");
  });

  it("closes on Escape", async () => {
    h.run.mockResolvedValueOnce(reply("Hmm."));
    render(<DraftTestPane draftId="d1" view={view()} fix={tools()} />);
    await ask("q");
    await screen.findByText("Hmm.");
    fireEvent.click(screen.getByRole("button", { name: F.button }));
    fireEvent.keyDown(screen.getByRole("region", { name: F.panel }), { key: "Escape" });
    expect(screen.queryByRole("region", { name: F.panel })).toBeNull();
  });

  it("add as new goes through the add a fact path", async () => {
    const t = tools();
    h.run.mockResolvedValueOnce(reply("Hmm.")).mockResolvedValueOnce(reply("Yes."));
    render(<DraftTestPane draftId="d1" view={view()} fix={t} />);
    await ask("Is there parking?");
    await screen.findByText("Hmm.");
    await openFix(F.correct);
    fireEvent.click(screen.getByRole("radio", { name: F.addNew }));
    fireEvent.change(screen.getByLabelText(A.label), { target: { value: "Yes, free." } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: A.add }));
    });
    const [target, ops] = t.edit.mock.calls[0];
    expect(target).toBe("learned");
    expect(ops[0]).toMatchObject({
      op: "add",
      path: "/facts/-",
      value: {
        section: "faqs",
        text: "Q: Is there parking? A: Yes, free.",
        sourceUrl: "owner",
        byOwner: true,
      },
    });
    await screen.findByText("Yes.");
  });
});

describe("Add a fact", () => {
  it("shows only for replies that declined and would be filed", async () => {
    h.run
      .mockResolvedValueOnce(reply("Fine."))
      .mockResolvedValueOnce(reply("Odd.", { handledBy: "declined", wouldFileUnanswered: null }))
      .mockResolvedValueOnce(declined());
    render(<DraftTestPane draftId="d1" view={view()} fix={tools()} />);
    await ask("one");
    await screen.findByText("Fine.");
    expect(screen.queryByLabelText(A.label)).toBeNull();
    await ask("two");
    await screen.findByText("Odd.");
    expect(screen.queryByLabelText(A.label)).toBeNull();
    await ask("three");
    await screen.findByText("I don't know.");
    expect(screen.getAllByLabelText(A.label)).toHaveLength(1);
  });

  it("builds the owner fact and asks again", async () => {
    const t = tools();
    h.run.mockResolvedValueOnce(declined()).mockResolvedValueOnce(reply("Eight."));
    render(<DraftTestPane draftId="d1" view={view()} fix={t} />);
    await ask("When do you open?");
    await screen.findByText("I don't know.");
    fireEvent.change(screen.getByLabelText(A.label), { target: { value: "At eight." } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: A.add }));
    });
    const [target, ops] = t.edit.mock.calls[0];
    expect(target).toBe("learned");
    expect(ops).toHaveLength(1);
    expect(ops[0].value.id).toBeTruthy();
    expect(ops[0].value).toMatchObject({
      section: "faqs",
      text: "Q: When do you open? A: At eight.",
      sourceUrl: "owner",
      byOwner: true,
    });
    await screen.findByText("Eight.");
  });

  it("blocks over 500 letters with a plain count", async () => {
    const t = tools();
    h.run.mockResolvedValueOnce(declined());
    render(<DraftTestPane draftId="d1" view={view()} fix={t} />);
    await ask("Q?");
    await screen.findByText("I don't know.");
    fireEvent.change(screen.getByLabelText(A.label), { target: { value: "x".repeat(500) } });
    expect(screen.getByRole("alert").textContent).toContain("509 letters");
    const add = screen.getByRole("button", { name: A.add }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.submit(add.closest("form") as HTMLFormElement);
    expect(t.edit).not.toHaveBeenCalled();
  });

  it("says Still learning your change when pages are pending after a fix", async () => {
    h.run
      .mockResolvedValueOnce(declined())
      .mockResolvedValueOnce(reply("Maybe.", { preview: { pendingDocuments: 1 } }));
    render(<DraftTestPane draftId="d1" view={view()} fix={tools()} />);
    await ask("Q?");
    await screen.findByText("I don't know.");
    fireEvent.change(screen.getByLabelText(A.label), { target: { value: "A" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: A.add }));
    });
    expect(await screen.findByText(SPLIT_COPY.stillLearning)).toBeTruthy();
  });
});

describe("Save as a test", () => {
  it("posts the case, shows it once and disables the button", async () => {
    h.addCase.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    h.run.mockResolvedValueOnce(reply("Fine."));
    render(<DraftTestPane draftId="d1" view={view()} fix={tools()} />);
    await ask("Is it open?");
    await screen.findByText("Fine.");
    fireEvent.click(screen.getByRole("button", { name: S.button }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: S.dontKnow }));
    });
    expect(h.addCase).toHaveBeenCalledWith({
      id: "b1",
      input: { question: "Is it open?", outcome: "dont_know", addedFrom: "chat" },
    });
    expect(screen.getAllByText("Saved to your checkup: Is it open?")).toHaveLength(1);
    expect((screen.getByRole("button", { name: S.button }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("posts answer, and says plainly when it fails", async () => {
    h.addCase.mockReturnValueOnce({ unwrap: () => Promise.reject(new Error("500")) });
    h.run.mockResolvedValueOnce(reply("Fine."));
    render(<DraftTestPane draftId="d1" view={view()} fix={tools()} />);
    await ask("Q?");
    await screen.findByText("Fine.");
    fireEvent.click(screen.getByRole("button", { name: S.button }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: S.answer }));
    });
    expect(h.addCase.mock.calls[0][0].input.outcome).toBe("answer");
    expect(screen.getByText(S.failed)).toBeTruthy();
    expect((screen.getByRole("button", { name: S.button }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe("Couldn't answer list", () => {
  it("counts, toggles, scrolls to the box, and drops answered questions", async () => {
    h.run
      .mockResolvedValueOnce(declined("No idea."))
      .mockResolvedValueOnce(declined("No clue."))
      .mockResolvedValueOnce(reply("Now I know."));
    const { rerender } = render(<DraftTestPane draftId="d1" view={view()} fix={tools()} />);
    expect(screen.queryByRole("button", { name: /Couldn't answer/ })).toBeNull();
    await ask("first?");
    await screen.findByText("No idea.");
    await ask("second?");
    await screen.findByText("No clue.");
    const button = screen.getByRole("button", { name: "Couldn't answer (2)" });
    await waitFor(
      () => expect(document.body.textContent).toContain(U.announce.replace("{n}", "2")),
      { timeout: 5000 },
    );
    expect(screen.queryByText("first?", { selector: "span.ally-small" })).toBeNull();
    fireEvent.click(button);
    const list = screen.getByRole("list", { name: U.heading });
    expect(list.textContent).toContain("first?");
    expect(list.textContent).toContain("second?");
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    fireEvent.click(list.querySelectorAll("button")[1]);
    expect(scroll).toHaveBeenCalled();

    // Asked again after a change: the answered one leaves.
    rerender(<DraftTestPane draftId="d1" view={view({ version: 2 })} fix={tools()} />);
    fireEvent.click(await screen.findByRole("button", { name: T.askAgain }));
    await screen.findByText("Now I know.");
    expect(screen.getByRole("button", { name: "Couldn't answer (1)" })).toBeTruthy();
  });
});
