import React from "react";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({ run: vi.fn(), cancel: vi.fn(), fallback: vi.fn(), likely: vi.fn() }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTestBotDraftMutation: () => [h.fallback],
  useRunLikelyBotDraftMutation: () => [h.likely],
}));
vi.mock("@hooks/useChatbotTestStream", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useChatbotTestStream: () => ({ run: h.run, cancel: h.cancel }),
}));

// eslint-disable-next-line import/first
import { SPLIT_COPY } from "../copy";
// eslint-disable-next-line import/first
import { DraftTestPane } from "../DraftTestPane";

const T = SPLIT_COPY.pane;
const C = SPLIT_COPY.channel;

const view = {
  id: "d1",
  status: "active",
  version: 1,
  chatbotId: "b1",
  draft: { assistantName: "Sunny", introduction: "Hi", suggestedQuestions: [] },
} as never;

beforeEach(() => {
  h.run.mockReset();
});

describe("channel toggle", () => {
  it("is a labelled radio group with Bot page chosen first", () => {
    render(<DraftTestPane draftId="d1" view={view} />);
    const group = screen.getByRole("radiogroup", { name: C.label });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map(r => r.textContent)).toEqual(["Bot page", "WhatsApp", "Widget"]);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("draft-test-transcript").className).toContain("ally-dt__list--page");
    expect(screen.queryByTestId("draft-test-strip")).toBeNull();
  });

  it("changes only the look: the class and a header strip, never the reply text or the request", async () => {
    h.run.mockResolvedValue({
      reply: "Ten dollars.",
      handledBy: "rag",
      citations: [],
      conversationId: "c",
    });
    render(<DraftTestPane draftId="d1" view={view} />);
    fireEvent.change(screen.getByLabelText(T.inputLabel), { target: { value: "Fees?" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: T.send }));
    });
    await screen.findByText("Ten dollars.");
    const request = JSON.stringify(h.run.mock.calls[0][0]);

    fireEvent.click(screen.getByRole("radio", { name: C.whatsapp }));
    const list = screen.getByTestId("draft-test-transcript");
    expect(list.className).toContain("ally-dt__list--whatsapp");
    expect(screen.getByTestId("draft-test-strip").textContent).toContain(C.whatsappStrip);
    expect(screen.getByText("Ten dollars.")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: C.widget }));
    expect(list.className).toContain("ally-dt__list--widget");
    expect(screen.getByTestId("draft-test-strip").textContent).toContain(C.widgetStrip);
    expect(screen.getByText("Ten dollars.")).toBeTruthy();
    expect(list.querySelectorAll("li").length).toBe(2);

    // The same question asked while WhatsApp is on goes out as the same request.
    fireEvent.click(screen.getByRole("radio", { name: C.whatsapp }));
    fireEvent.change(screen.getByLabelText(T.inputLabel), { target: { value: "Fees?" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: T.send }));
    });
    await waitFor(() => expect(h.run).toHaveBeenCalledTimes(2));
    const second = h.run.mock.calls[1][0];
    expect(second.message).toBe(JSON.parse(request).message);
    expect(second.id).toBe(JSON.parse(request).id);
    expect(second.history.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);

    fireEvent.click(screen.getByRole("radio", { name: C.page }));
    expect(screen.queryByTestId("draft-test-strip")).toBeNull();
  });
});
