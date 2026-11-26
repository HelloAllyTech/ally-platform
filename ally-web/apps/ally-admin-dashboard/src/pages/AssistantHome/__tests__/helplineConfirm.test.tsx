import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

/** TF1 S4: the template's helpline number waited for a confirm only staff could see. */
const h = vi.hoisted(() => ({
  overrides: {} as Record<string, unknown>,
  put: vi.fn(),
}));

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetChatbotSettingsQuery: () => ({ data: { overrides: h.overrides }, isError: false }),
  useUpdateChatbotSettingsMutation: () => [
    (args: unknown) => ({ unwrap: () => h.put(args) }),
    { isLoading: false },
  ],
}));

/* eslint-disable import/first */
import { TF1_COPY } from "../copy/tf1";
import { HelplineConfirm } from "../sections/Safety";
/* eslint-enable import/first */

const waiting = {
  helplineNumbers: "1800-200-3000",
  helplineSource: "template",
  helplineConfirmedAt: null,
  audienceAge: "adults",
};

beforeEach(() => {
  h.overrides = waiting;
  h.put.mockReset().mockImplementation(async ({ settings }: { settings: object }) => ({
    overrides: {
      ...settings,
      helplineSource: "owner",
      helplineConfirmedAt: "2026-11-25T00:00:00Z",
    },
  }));
});

describe("the helpline confirm in Safety", () => {
  it("shows the number waiting, and confirming sends the stored settings with the confirm", async () => {
    render(<HelplineConfirm botId="bot-1" canEdit />);
    expect(screen.getByTestId("helpline-unconfirmed").textContent).toContain("1800-200-3000");
    fireEvent.click(screen.getByRole("button", { name: TF1_COPY.helpline.confirm }));
    await waitFor(() => expect(screen.getByTestId("helpline-confirmed")).toBeTruthy());
    expect(h.put).toHaveBeenCalledWith({
      id: "bot-1",
      settings: { ...waiting, helplineConfirm: true },
    });
    expect(screen.queryByTestId("helpline-unconfirmed")).toBeNull();
  });

  it.each([
    [{ ...waiting, helplineSource: "owner" }],
    [{ ...waiting, helplineConfirmedAt: "2026-11-24T00:00:00Z" }],
    [{ ...waiting, helplineNumbers: "" }],
  ])("says nothing once the number is the owner's, confirmed, or empty", overrides => {
    h.overrides = overrides;
    render(<HelplineConfirm botId="bot-1" canEdit />);
    expect(screen.queryByTestId("helpline-unconfirmed")).toBeNull();
  });

  it("TF1 round 2, S-1: the owner sees and corrects exactly what crisis replies will give", async () => {
    render(<HelplineConfirm botId="bot-1" canEdit />);
    expect(screen.getByTestId("helpline-preview").textContent).toContain(
      "You can also call 1800-200-3000.",
    );
    fireEvent.change(screen.getByTestId("helpline-field"), {
      target: { value: "+91 20 4860 2525" },
    });
    expect(screen.getByTestId("helpline-preview").textContent).toContain(
      "You can also call +91 20 4860 2525.",
    );
    fireEvent.click(screen.getByRole("button", { name: TF1_COPY.helpline.confirm }));
    await waitFor(() => expect(screen.getByTestId("helpline-confirmed")).toBeTruthy());
    expect(h.put).toHaveBeenCalledWith({
      id: "bot-1",
      settings: { ...waiting, helplineNumbers: "+91 20 4860 2525", helplineConfirm: true },
    });
  });

  it("shows ally-be's reason when the text has no number", async () => {
    h.put.mockReset().mockRejectedValue({
      status: 400,
      data: { message: "Add the phone number crisis replies should give." },
    });
    render(<HelplineConfirm botId="bot-1" canEdit />);
    fireEvent.change(screen.getByTestId("helpline-field"), {
      target: { value: "Open 10 am to 10 pm" },
    });
    fireEvent.click(screen.getByRole("button", { name: TF1_COPY.helpline.confirm }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Add the phone number"),
    );
  });

  it("a viewer sees the line, not the button", () => {
    render(<HelplineConfirm botId="bot-1" canEdit={false} />);
    expect(screen.getByTestId("helpline-unconfirmed")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
