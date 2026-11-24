import React from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({ test: vi.fn(), draftId: "wc1" }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetChatbotWorkingCopyQuery: () => ({ data: { draftId: h.draftId }, isError: false }),
  useRunCrisisCheckMutation: () => [
    (args: unknown) => ({ unwrap: () => h.test(args) }),
    { isLoading: false },
  ],
}));
vi.mock("../create/BuildScreen", () => ({
  BuildScreen: (p: { draftId: string; surface: string }) => {
    // State set at mount, like the screen's remembered mode: a stale one would outlive a switch.
    const [first] = React.useState(p.draftId);
    return <div data-testid="build-screen-stub">{`${p.draftId}:${p.surface}:${first}`}</div>;
  },
}));

/* eslint-disable import/first */
import { ChatbotBuild } from "../create/ChatbotBuild";
import { BUILD_COPY } from "../create/copy";
/* eslint-enable import/first */

const K = BUILD_COPY.checkup;

describe("Build for an existing chatbot", () => {
  beforeEach(() => h.test.mockReset());

  it("opens the same Create and Build screen on the chatbot's working copy", () => {
    render(<ChatbotBuild chatbotId="b1" canEdit archived={false} part="screen" />);
    expect(screen.getByTestId("build-screen-stub").textContent).toBe("wc1:build:wc1");
  });

  it("starts the screen afresh for another chatbot, so one's mode never carries to the next", () => {
    const { rerender } = render(
      <ChatbotBuild chatbotId="b1" canEdit archived={false} part="screen" />,
    );
    h.draftId = "wc2";
    rerender(<ChatbotBuild chatbotId="b2" canEdit archived={false} part="screen" />);
    expect(screen.getByTestId("build-screen-stub").textContent).toBe("wc2:build:wc2");
    h.draftId = "wc1";
  });

  it("puts the crisis check and likely questions first, saved tests under Advanced", async () => {
    h.test.mockResolvedValue({
      results: [],
      checklist: {
        languages: [{ language: "en", status: "pass", checkedAt: null, passed: 8, total: 8 }],
      },
    });
    render(
      <ChatbotBuild
        chatbotId="b1"
        canEdit
        archived={false}
        part="checkup"
        advanced={<div>saved tests</div>}
      />,
    );
    const upfront = screen.getByTestId("checkup-upfront");
    const advanced = screen.getByTestId("checkup-advanced");
    expect(
      upfront.compareDocumentPosition(advanced) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(advanced.textContent).toContain(K.advanced);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: K.crisisRun }));
    });
    expect(h.test.mock.calls[0][0]).toEqual({ chatbotId: "b1" });
    expect((await screen.findByTestId("crisis-result")).textContent).toContain(K.crisisOk);
  });

  it("says so when a language failed the crisis check (it is turned off for customers)", async () => {
    h.test.mockResolvedValue({
      results: [],
      checklist: {
        languages: [
          { language: "en", status: "pass", checkedAt: null, passed: 8, total: 8 },
          { language: "hi", status: "off", checkedAt: null, passed: 5, total: 8 },
        ],
      },
    });
    render(<ChatbotBuild chatbotId="b1" canEdit archived={false} part="checkup" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: K.crisisRun }));
    });
    const result = await screen.findByTestId("crisis-result");
    expect(result.textContent).toContain(K.crisisBad);
    expect(result.textContent).toContain(BUILD_COPY.goLive.languageStatus.off);
  });
});
