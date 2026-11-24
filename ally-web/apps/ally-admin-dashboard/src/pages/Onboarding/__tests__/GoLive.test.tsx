import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

type Fn = ReturnType<typeof vi.fn>;
const h = vi.hoisted(() => ({
  publish: null as unknown as Fn,
  list: undefined as unknown,
  checklist: undefined as unknown,
}));

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetGoLiveChecklistQuery: () => ({ data: h.checklist, refetch: vi.fn() }),
  useGetAccessListQuery: () => ({ data: h.list }),
  useGetSafetyTermsQuery: () => ({ data: undefined }),
  useGetChatbotSettingsQuery: () => ({ data: { overrides: {} }, isError: false }),
  useUpdateChatbotSettingsMutation: () => [vi.fn(), { isLoading: false }],
  useAcceptSafetyTermsMutation: () => [vi.fn(), { isLoading: false }],
  useRunCrisisCheckMutation: () => [vi.fn(), { isLoading: false }],
  usePublishBotDraftMutation: () => [
    (args: unknown) => ({ unwrap: () => h.publish(args) }),
    { isLoading: false },
  ],
}));

/* eslint-disable import/first */
import { BUILD_COPY, GO_LIVE_ACCESS_COPY } from "../create/copy";
import { GoLiveSection } from "../create/GoLive";
import { TF1_COPY } from "../../AssistantHome/copy/tf1";
/* eslint-enable import/first */

const green = {
  ok: true,
  enforced: true,
  items: [{ item: "crisis_check", done: true, message: "English crisis check passed" }],
  languages: [{ language: "en", status: "pass" }],
};

const renderSection = () =>
  render(
    <GoLiveSection
      draftId="draft-1"
      chatbotId="bot-1"
      live={false}
      onLive={vi.fn()}
      onCreditsOut={vi.fn()}
    />,
  );

describe("GoLiveSection", () => {
  beforeEach(() => {
    h.publish = vi.fn().mockResolvedValue({ link: "https://ally.example/b/x" });
    h.list = [];
    h.checklist = green;
  });

  it("has no access choice or email box of its own", () => {
    const { container } = renderSection();
    expect(screen.queryByText("Who can open it")).toBeNull();
    expect(screen.queryByText("Only people I invite")).toBeNull();
    expect(screen.queryByText("Email addresses, one per line")).toBeNull();
    expect(container.querySelector('input[name="draft-1-access"]')).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("publishes invite only with no emails: the access list decides who may chat", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: BUILD_COPY.goLive.publish }));
    await waitFor(() => expect(h.publish).toHaveBeenCalled());
    expect(h.publish).toHaveBeenCalledWith({ id: "draft-1", access: "invite" });
  });

  it("says nobody can chat yet while the access list is empty", () => {
    renderSection();
    expect(screen.getByTestId("golive-nobody-yet").textContent).toBe(GO_LIVE_ACCESS_COPY.nobodyYet);
  });

  it("drops that line once someone is on the list", () => {
    h.list = [{ id: "e1", kind: "phone", value: "+919820012345" }];
    renderSection();
    expect(screen.queryByTestId("golive-nobody-yet")).toBeNull();
  });

  it("keeps Go live off while the gate is red", () => {
    h.checklist = { ...green, ok: false };
    renderSection();
    expect(
      (screen.getByRole("button", { name: BUILD_COPY.goLive.publish }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  // TF1 S2: it went live into "answers nobody" without a word about the budget.
  it.each([
    [{ setAsideUsd: 2, added: true }, TF1_COPY.goLive.budgetAdded.replace("{amount}", "2.00")],
    [{ setAsideUsd: 0, added: false }, TF1_COPY.goLive.budgetNone],
  ])("says what is set aside for replies once live (%o)", async (budget, line) => {
    h.publish = vi.fn().mockResolvedValue({ link: "https://ally.example/b/x", budget });
    const props = { draftId: "draft-1", chatbotId: "bot-1", onCreditsOut: vi.fn() };
    const onLive = vi.fn();
    const { rerender } = render(<GoLiveSection {...props} live={false} onLive={onLive} />);
    fireEvent.click(screen.getByRole("button", { name: BUILD_COPY.goLive.publish }));
    await waitFor(() => expect(onLive).toHaveBeenCalled());
    rerender(<GoLiveSection {...props} live onLive={onLive} />);
    expect(screen.getByTestId("golive-budget").textContent).toBe(line);
  });
});
