import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@constants";

const h = vi.hoisted(() => ({
  settings: { overrides: {} } as { overrides: Record<string, unknown> },
  put: vi.fn(),
  approve: vi.fn(),
  review: [] as unknown[],
  replies: [] as unknown[],
  change: vi.fn(),
}));

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetChatbotSettingsQuery: () => ({ data: h.settings, isError: false }),
  useUpdateChatbotSettingsMutation: () => [h.put, { isLoading: false }],
  useGetKnowledgeReviewQuery: () => ({ data: { documents: h.review } }),
  useApproveKnowledgeMutation: () => [h.approve],
  useExcludeKnowledgeMutation: () => [vi.fn()],
  useGetKnowledgeFreshnessQuery: () => ({ data: { knowledgeStaleDays: 12 } }),
  useGetChatbotDocumentsQuery: () => ({ data: [] }),
  useReadSourceAgainMutation: () => [vi.fn(), { isLoading: false }],
  useGetChatbotsQuery: () => ({ data: { chatbots: [] } }),
  useCopyKnowledgeFromMutation: () => [vi.fn(), { isLoading: false }],
  useGetCuratedKnowledgeQuery: () => ({ data: { documents: [] } }),
  useAddKnowledgeFromPoolMutation: () => [vi.fn()],
}));

vi.mock("../useHomeList", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useHomeList: () => ({
    loading: false,
    failed: false,
    saving: false,
    error: null,
    items: h.replies,
    change: h.change,
    refetch: vi.fn(),
  }),
}));

/* eslint-disable import/first */
import { KnowledgeTools } from "../sections/KnowledgeTools";
import { QuickReplies, isLocked } from "../sections/QuickReplies";
import { SafetyPrivacy } from "../safety/SafetyPrivacy";
/* eslint-enable import/first */

const reject = (status: number, message?: string) => ({
  unwrap: () => Promise.reject({ status, data: message ? { message } : {} }),
});

beforeEach(() => {
  h.settings = { overrides: { rateLimit: 5 } };
  h.put.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({ overrides: {} }) });
  h.change.mockReset().mockResolvedValue(true);
  h.review = [];
  h.replies = [];
});

describe("Safety and privacy settings", () => {
  it("saves the audience on top of the stored settings, so nothing else is wiped", async () => {
    render(<SafetyPrivacy botId="b1" canEdit />);
    fireEvent.click(screen.getByLabelText("Adults only"));
    await waitFor(() => expect(h.put).toHaveBeenCalled());
    expect(h.put).toHaveBeenCalledWith({
      id: "b1",
      settings: { rateLimit: 5, audienceAge: "adults" },
    });
  });

  it("shows the owner-only refusal plainly", async () => {
    h.put.mockReturnValue(reject(403));
    render(<SafetyPrivacy botId="b1" canEdit />);
    fireEvent.click(screen.getByLabelText("Adults only"));
    expect(await screen.findByText(/Only an owner can make this setting less strict/)).toBeTruthy();
  });

  it("shows the backend's validation message", async () => {
    h.put.mockReturnValue(reject(400, "retentionDays is a whole number from 7 to 365"));
    render(<SafetyPrivacy botId="b1" canEdit />);
    const box = screen.getByLabelText(/Keep chats for/);
    fireEvent.change(box, { target: { value: "2" } });
    fireEvent.blur(box);
    expect(await screen.findByText(/whole number from 7 to 365/)).toBeTruthy();
  });

  it("offers alerts only as straight away or digest, never off", () => {
    render(<SafetyPrivacy botId="b1" canEdit />);
    const group = screen.getByTestId("safety-alerts");
    expect(group.querySelectorAll('input[type="radio"]').length).toBe(2);
  });

  it("is read-only for a viewer", () => {
    render(<SafetyPrivacy botId="b1" canEdit={false} />);
    expect(screen.getByTestId("safety-audience")).toBeDisabled();
  });
});

describe("Locked quick replies", () => {
  const reply = (over: Record<string, unknown>) => ({
    id: "r1",
    kind: "crisis",
    name: "Crisis",
    patterns: ["help"],
    responseText: "Call findahelpline.com",
    active: true,
    required: true,
    state: "default",
    defaultId: null,
    defaultResponseText: null,
    ...over,
  });

  it("treats crisis, STOP and START as locked and FAQs as editable", () => {
    expect(isLocked(reply({}) as never)).toBe(true);
    expect(isLocked(reply({ kind: "command" }) as never)).toBe(true);
    expect(isLocked(reply({ kind: "faq", required: false }) as never)).toBe(false);
    expect(isLocked(reply({ kind: "faq", required: false, locked: true }) as never)).toBe(true);
  });

  it("a locked row has no reword, and saves regional numbers", async () => {
    h.replies = [reply({}), reply({ id: "r2", kind: "faq", required: false, name: "Hours" })];
    render(<QuickReplies botId="b1" canEdit />);
    // One Reword button (the FAQ), one regional-numbers button (the locked row).
    expect(screen.getAllByRole("button", { name: "Reword" }).length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Regional numbers to add" }));
    fireEvent.change(screen.getByLabelText("Regional numbers to add"), {
      target: { value: "1800 111\n1800 222" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save numbers" }));
    await waitFor(() =>
      expect(h.change).toHaveBeenCalledWith(
        { op: "edit", id: "r1", item: { extraNumbers: ["1800 111", "1800 222"] } },
        expect.any(Function),
      ),
    );
  });
});

describe("Knowledge review", () => {
  it("lists held sources with what was found, and approves one", async () => {
    h.review = [
      {
        id: "d1",
        title: "Staff.pdf",
        status: "held",
        findings: [{ kind: "email", sample: "a***z", count: 2 }],
      },
    ];
    h.approve.mockReturnValue({ unwrap: () => Promise.resolve() });
    render(<KnowledgeTools bot={{ id: "b1" } as never} canEdit canManage />);
    expect(screen.getByText("Staff.pdf")).toBeTruthy();
    expect(screen.getByText(/email \(2\) a\*\*\*z/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(h.approve).toHaveBeenCalledWith({ id: "b1", documentId: "d1" }));
  });

  it("only an owner can approve", () => {
    h.review = [{ id: "d1", title: "Staff.pdf", status: "held", findings: [] }];
    render(<KnowledgeTools bot={{ id: "b1" } as never} canEdit canManage={false} />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });
});
