import { describe, expect, it } from "vitest";

import { ChatbotStatus, type Chatbot } from "@types";

import { isBlankDraft } from "../blank";

const draft = (over: Partial<Chatbot> = {}): Chatbot =>
  ({
    status: ChatbotStatus.DRAFT,
    setupDraftId: "d1",
    documentCount: 0,
    readyDocumentCount: 0,
    connectors: [],
    description: null,
    lastTestedAt: null,
    stats: { messages: 0, people: 0 },
    ...over,
  }) as Chatbot;

describe("isBlankDraft", () => {
  it("is true for a draft with a setup session and no content", () => {
    expect(isBlankDraft(draft())).toBe(true);
  });
  it.each([
    ["a document", { documentCount: 1 }],
    ["a ready document", { readyDocumentCount: 1 }],
    ["a message", { stats: { messages: 1, people: 0 } }],
    ["a connector", { connectors: [{ id: "c" }] }],
    ["a description", { description: "Helps with refunds" }],
    ["a test", { lastTestedAt: "2026-11-20T00:00:00Z" }],
  ])("is false once it has %s", (_label, over) => {
    expect(isBlankDraft(draft(over as Partial<Chatbot>))).toBe(false);
  });
  it("is false for a chatbot that is not a draft, or has no setup session", () => {
    expect(isBlankDraft(draft({ status: ChatbotStatus.LIVE }))).toBe(false);
    expect(isBlankDraft(draft({ setupDraftId: null }))).toBe(false);
  });
  it("trusts an explicit blank flag over the inference", () => {
    expect(isBlankDraft(draft({ blank: false }))).toBe(false);
    expect(isBlankDraft(draft({ status: ChatbotStatus.LIVE, blank: true }))).toBe(true);
  });
});
