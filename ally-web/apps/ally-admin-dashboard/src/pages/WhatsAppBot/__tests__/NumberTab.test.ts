import { describe, expect, it, vi } from "vitest";

import { WaBusinessNumber, WaBusinessNumberStatus } from "@types";

vi.mock("@api", () => ({}));
vi.mock("@components", () => ({}));
vi.mock("@components/types", () => ({ ButtonVariant: {} }));
vi.mock("@ally-ui-mono/ui-shared", () => ({}));
vi.mock("../shared", () => ({}));
vi.mock("@constants", () => ({
  en: {
    whatsappBot: {
      number: { step1: "1", step2: "2", step3: "3", step4: "4" },
      connection: {},
      bots: { channels: {} },
    },
  },
}));

const { numberStep } = await import("../NumberTab");

const number = (over: Partial<WaBusinessNumber>): WaBusinessNumber =>
  ({
    id: "n1",
    tenantId: "org-a",
    status: WaBusinessNumberStatus.CONNECTED,
    lastInboundAt: null,
    ...over,
  }) as WaBusinessNumber;

/**
 * The connect flow's step is READ from the number it created, not remembered by the page, so it
 * moves on by itself when Meta confirms — and "done" means a message has
 * actually arrived, not merely that the details were accepted.
 */
describe("numberStep", () => {
  it("starts with what to get from Meta, then the form", () => {
    expect(numberStep(undefined, false)).toBe("details");
    expect(numberStep(undefined, true)).toBe("connect");
  });

  it("waits on Meta's webhook check once the details are saved", () => {
    expect(numberStep(number({ status: WaBusinessNumberStatus.AWAITING_WEBHOOK }), true)).toBe(
      "webhook",
    );
  });

  it("is not done until a message has actually arrived", () => {
    expect(numberStep(number({}), false)).toBe("test");
    expect(numberStep(number({ lastInboundAt: "2026-11-04T10:00:00Z" }), false)).toBe("done");
  });

  it("shows a broken number as its status card, not the setup steps", () => {
    expect(numberStep(number({ status: WaBusinessNumberStatus.ERROR }), false)).toBe("done");
  });
});
