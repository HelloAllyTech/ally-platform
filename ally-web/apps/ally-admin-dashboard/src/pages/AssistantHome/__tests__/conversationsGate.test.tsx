import React from "react";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/** Conversations: a Responder-only member sees the agreement first; an owner sees the chats. */
let accepted = false;
vi.mock("@api", () => ({
  useGetResponderAgreementQuery: () => ({
    data: {
      currentVersion: "v1",
      text: "agreement text",
      accepted,
      acceptedVersion: null,
      acceptedAt: null,
      enforced: true,
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAcceptResponderAgreementMutation: () => [vi.fn(), { isLoading: false }],
}));
vi.mock("../../Inbox", () => ({ Inbox: () => <p>the inbox</p> }));
vi.mock("../../ChatbotSupport/StaffConversations", () => ({
  StaffConversations: () => <p>staff conversations</p>,
}));
vi.mock("../sections/AccessLists", () => ({ LoadFailed: () => <p>failed</p> }));

const { ConversationsSection } = await import("../sections/Conversations");

const props = (roles: string[]) =>
  ({ bot: { id: "b1", myRole: roles[0], myRoles: roles } }) as unknown as React.ComponentProps<
    typeof ConversationsSection
  >;

describe("Conversations and the responder agreement", () => {
  it("holds a Responder at the agreement until it is accepted", () => {
    accepted = false;
    render(<ConversationsSection {...props(["responder"])} />);
    expect(screen.queryByText("the inbox")).toBeNull();
    expect(screen.getByText("agreement text")).toBeInTheDocument();
  });

  it("opens the chats for a Responder who accepted", () => {
    accepted = true;
    render(<ConversationsSection {...props(["responder"])} />);
    expect(screen.getByText("the inbox")).toBeInTheDocument();
  });

  it("opens the chats for an owner without asking up front", () => {
    accepted = false;
    render(<ConversationsSection {...props(["owner", "responder"])} />);
    expect(screen.getByText("the inbox")).toBeInTheDocument();
    expect(screen.queryByText("agreement text")).toBeNull();
  });
});
