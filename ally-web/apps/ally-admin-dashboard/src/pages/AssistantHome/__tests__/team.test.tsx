import React from "react";

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The team (Stage 1b): roles are checkboxes (any mix, never none), refusals are explained from
 * their error codes, the creator can hand over, anyone can leave, owners invite by email and
 * revoke what is waiting.
 */
let members: unknown[] = [];
let invites: unknown[] = [];
const setMembers = vi.fn();
const removeMember = vi.fn();
const leave = vi.fn();
const transfer = vi.fn();
const createInvite = vi.fn();
const revokeInvite = vi.fn();
vi.mock("@api", () => ({
  useGetChatbotMembersQuery: () => ({
    data: members,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGetChatbotInvitesQuery: () => ({ data: invites }),
  useSetChatbotMembersMutation: () => [setMembers, { isLoading: false }],
  useRemoveChatbotMemberMutation: () => [removeMember, { isLoading: false }],
  useLeaveChatbotMutation: () => [leave, { isLoading: false }],
  useTransferChatbotMutation: () => [transfer, { isLoading: false }],
  useCreateChatbotInviteMutation: () => [createInvite, { isLoading: false }],
  useRevokeChatbotInviteMutation: () => [revokeInvite, { isLoading: false }],
}));
vi.mock("../sections/AccessLists", () => ({ LoadFailed: () => <p>failed</p> }));

const { TeamList } = await import("../sections/Team");

const ok = (value: unknown = {}) => ({ unwrap: () => Promise.resolve(value) });
const refused = (errorCode: string, status = 409) => ({
  unwrap: () => Promise.reject({ status, data: { errorCode, message: "server words" } }),
});

beforeEach(() => {
  [setMembers, removeMember, leave, transfer, createInvite, revokeInvite].forEach(fn =>
    fn.mockReset(),
  );
  members = [
    {
      userId: 7,
      name: "Shehbaz",
      email: "s@clinic.test",
      role: "owner",
      roles: ["owner"],
      isCreator: true,
    },
    {
      userId: 8,
      name: "Meera",
      email: "m@clinic.test",
      role: "editor",
      roles: ["editor", "responder"],
      isCreator: false,
    },
  ];
  invites = [
    {
      id: "inv-1",
      email: "ravi@clinic.test",
      roles: ["viewer"],
      invitedBy: 7,
      expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      createdAt: new Date().toISOString(),
    },
  ];
});

describe("role checkboxes", () => {
  it("shows the whole set and saves a change with every member's roles", async () => {
    setMembers.mockReturnValue(ok());
    render(<TeamList botId="bot-1" canManage myUserId={7} />);
    const meera = screen.getByRole("group", { name: "Roles for Meera" });
    const boxes = within(meera)
      .getAllByRole("checkbox")
      .map(box => (box as HTMLInputElement).checked);
    // Owner, Editor, Responder, Viewer
    expect(boxes).toEqual([false, true, true, false]);

    await act(async () => fireEvent.click(screen.getAllByRole("checkbox", { name: "Viewer" })[1]));
    expect(setMembers).toHaveBeenCalledWith({
      id: "bot-1",
      members: [
        { userId: 7, roles: ["owner"] },
        { userId: 8, roles: ["editor", "responder", "viewer"] },
      ],
    });
  });

  it("never lets the last role go", async () => {
    render(<TeamList botId="bot-1" canManage myUserId={7} />);
    const owner = screen.getByRole("group", { name: "Roles for Shehbaz" });
    fireEvent.click(within(owner).getByRole("checkbox", { checked: true }));
    expect(setMembers).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Keep at least one role");
  });

  it("explains a refused change as the last owner", async () => {
    members = [
      { ...(members[0] as object), role: "owner", roles: ["owner", "editor"] },
      members[1],
    ];
    setMembers.mockReturnValue(refused("last_owner"));
    render(<TeamList botId="bot-1" canManage myUserId={8} />);
    const owner = screen.getByRole("group", { name: "Roles for Shehbaz" });
    await act(async () => fireEvent.click(within(owner).getAllByRole("checkbox")[0]));
    expect(setMembers).toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This is the only owner. Make someone else an owner first.",
    );
  });

  it("is read-only for someone who can't manage", () => {
    render(<TeamList botId="bot-1" canManage={false} myUserId={8} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("Only an owner can change the team.")).toBeInTheDocument();
    expect(screen.queryByTestId("team-invites")).toBeNull();
  });
});

describe("remove, leave and hand over", () => {
  it("explains a creator who tries to leave", async () => {
    leave.mockReturnValue(refused("creator_must_transfer"));
    render(<TeamList botId="bot-1" canManage myUserId={7} />);
    fireEvent.click(screen.getByRole("button", { name: "Leave this chatbot" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Leave" })));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "You created this chatbot. Hand it over to another owner before you leave.",
    );
  });

  it("leaves and tells the page", async () => {
    leave.mockReturnValue(ok());
    const onLeft = vi.fn();
    render(<TeamList botId="bot-1" canManage={false} myUserId={8} onLeft={onLeft} />);
    fireEvent.click(screen.getByRole("button", { name: "Leave this chatbot" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Leave" })));
    expect(leave).toHaveBeenCalledWith({ id: "bot-1" });
    expect(onLeft).toHaveBeenCalled();
  });

  it("explains removing the creator", async () => {
    removeMember.mockReturnValue(refused("creator_must_transfer"));
    render(<TeamList botId="bot-1" canManage myUserId={8} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Shehbaz" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove" })));
    expect(removeMember).toHaveBeenCalledWith({ id: "bot-1", userId: 7 });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This person created the chatbot. They need to hand it over to another owner first.",
    );
  });

  it("offers the hand over to the creator only, and sends the chosen member", async () => {
    transfer.mockReturnValue(ok());
    const { unmount } = render(<TeamList botId="bot-1" canManage myUserId={8} />);
    expect(screen.queryByTestId("team-transfer")).toBeNull();
    unmount();
    render(<TeamList botId="bot-1" canManage myUserId={7} />);
    fireEvent.change(screen.getByLabelText("Who takes over"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Hand over ownership" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Hand over" })));
    expect(transfer).toHaveBeenCalledWith({ id: "bot-1", userId: 8 });
    expect(screen.getByText("Handed over to Meera.")).toBeInTheDocument();
  });
});

describe("invites", () => {
  it("invites by email with the roles ticked", async () => {
    createInvite.mockReturnValue(ok({ emailSent: true }));
    render(<TeamList botId="bot-1" canManage myUserId={7} />);
    const form = screen.getByTestId("team-invites");
    fireEvent.change(screen.getByLabelText("Their email address"), {
      target: { value: "new@clinic.test" },
    });
    const responder = within(form).getAllByRole("checkbox")[2];
    fireEvent.click(responder);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send invite" })));
    expect(createInvite).toHaveBeenCalledWith({
      id: "bot-1",
      email: "new@clinic.test",
      roles: ["responder", "viewer"],
    });
    expect(screen.getByRole("status")).toHaveTextContent("Invite sent to new@clinic.test.");
  });

  it("says why an invite is refused", async () => {
    createInvite.mockReturnValue(refused("already_member"));
    render(<TeamList botId="bot-1" canManage myUserId={7} />);
    fireEvent.change(screen.getByLabelText("Their email address"), {
      target: { value: "m@clinic.test" },
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send invite" })));
    expect(screen.getByRole("alert")).toHaveTextContent("already on this chatbot's team");
  });

  it("lists what is waiting and revokes one", async () => {
    revokeInvite.mockReturnValue(ok());
    render(<TeamList botId="bot-1" canManage myUserId={7} />);
    expect(screen.getByTestId("pending-invites")).toHaveTextContent("ravi@clinic.test");
    fireEvent.click(screen.getByRole("button", { name: "Revoke invite for ravi@clinic.test" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove" })));
    expect(revokeInvite).toHaveBeenCalledWith({ id: "bot-1", inviteId: "inv-1" });
  });
});
