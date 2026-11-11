import React from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HomeSavesContext } from "../useHomeField";

/**
 * The home's lists (chunk 20d-2): each change is one entry, sent with the version of the list it
 * was based on; a change refused because the list changed elsewhere shows the server's words and
 * the list as it is now; a saved change offers Undo; someone who can't change it sees no controls.
 */
const lists: Record<string, { items: unknown[]; version: string; yourOrganisation?: unknown }> = {};
const send = vi.fn();
const patched = vi.fn();
vi.mock("@api", () => ({
  useGetHomeListQuery: ({ list }: { list: string }) => ({
    data: { list, ...lists[list] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useChangeHomeListMutation: () => [send],
  chatbotsApi: {
    util: {
      updateQueryData: (...args: unknown[]) => {
        patched(...args);
        return { type: "patched" };
      },
    },
  },
  useGetKbDocumentsQuery: () => ({ data: { documents: [] }, isLoading: false }),
  useCreateChatbotDocumentUploadUrlMutation: () => [vi.fn()],
  useCreatePrivateChatbotDocumentMutation: () => [vi.fn()],
}));
vi.mock("react-redux", () => ({ useDispatch: () => vi.fn() }));
vi.mock("../../WhatsAppBot/NumberTab", () => ({
  ConnectWhatsAppFlow: () => null,
  useWaNumbers: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));

const { PageAccessList } = await import("../sections/AccessLists");
const { TeamList } = await import("../sections/PeopleLists");
const { QuickReplies } = await import("../sections/QuickReplies");
const { DocumentsList } = await import("../sections/DocumentsList");

const resolves = (value: unknown) => ({ unwrap: () => Promise.resolve(value) });
const rejects = (data: unknown) => ({ unwrap: () => Promise.reject({ status: 409, data }) });

const saves = { changed: vi.fn(), status: vi.fn() };
const withSaves = (ui: React.ReactElement) =>
  render(<HomeSavesContext.Provider value={saves}>{ui}</HomeSavesContext.Provider>);

beforeEach(() => {
  send.mockReset();
  patched.mockReset();
  saves.changed.mockReset();
  lists.pageAccess = {
    items: [{ id: "e1", kind: "email", value: "asha@clinic.test", label: null }],
    version: "000000000000000a",
    yourOrganisation: { id: "t1", name: "Sunrise Mind" },
  };
  lists.team = {
    items: [
      { id: "7", userId: 7, name: "Shehbaz", email: "s@clinic.test", role: "owner" },
      { id: "8", userId: 8, name: "Meera", email: "m@clinic.test", role: "editor" },
    ],
    version: "000000000000000b",
  };
  lists.quickReplies = {
    items: [
      {
        id: "crisis-1",
        kind: "crisis",
        name: "Crisis",
        patterns: ["suicide"],
        responseText: "Please call 14416.",
        active: true,
        required: true,
        state: "default",
        defaultId: null,
        defaultResponseText: null,
      },
    ],
    version: "000000000000000c",
  };
  lists.documents = {
    items: [
      {
        id: "d1",
        title: "Fees",
        status: "indexed",
        private: false,
        isGlobal: true,
        archived: false,
      },
    ],
    version: "000000000000000d",
  };
});

describe("who can open the page", () => {
  it("adds an email with the list's version, and offers Undo that removes it", async () => {
    send.mockReturnValue(
      resolves({
        items: [...lists.pageAccess.items, { id: "e2", kind: "email", value: "ravi@clinic.test" }],
        version: "000000000000001a",
      }),
    );
    withSaves(<PageAccessList botId="bot-1" mode="invite" canEdit />);
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "ravi@clinic.test" },
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add" })));
    expect(send).toHaveBeenCalledWith({
      id: "bot-1",
      list: "pageAccess",
      version: "000000000000000a",
      change: { op: "add", item: { kind: "email", value: "ravi@clinic.test" } },
    });
    expect(saves.changed).toHaveBeenCalledTimes(1);
    send.mockReturnValue(resolves({ items: lists.pageAccess.items, version: "000000000000002a" }));
    act(() => saves.changed.mock.calls[0][0]());
    expect(send).toHaveBeenLastCalledWith({
      id: "bot-1",
      list: "pageAccess",
      version: "000000000000001a",
      change: { op: "remove", id: "e2" },
    });
  });

  it("shows the other tab's words when the list changed since", async () => {
    send.mockReturnValue(
      rejects({
        errorCode: "stale",
        message: "This changed while you were editing. Here is what it says now.",
        details: { list: "pageAccess", items: [], version: "000000000000009a" },
      }),
    );
    withSaves(<PageAccessList botId="bot-1" mode="invite" canEdit />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Remove asha@clinic.test" })),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This changed while you were editing. Here is what it says now.",
    );
    expect(patched).toHaveBeenCalledWith(
      "getHomeList",
      { id: "bot-1", list: "pageAccess" },
      expect.any(Function),
    );
  });

  it("offers the owner's organisation by name, never an id to type", () => {
    withSaves(<PageAccessList botId="bot-1" mode="organisation" canEdit />);
    expect(screen.getByRole("button", { name: "Add Sunrise Mind" })).toBeInTheDocument();
    expect(screen.queryByText(/organisation id/i)).toBeNull();
  });

  it("has no controls for someone who can't change it", () => {
    withSaves(<PageAccessList botId="bot-1" mode="invite" canEdit={false} />);
    expect(screen.getByText("asha@clinic.test")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByLabelText("Email address")).toBeNull();
  });
});

describe("the team", () => {
  it("adds by email with today's roles, and changes a role with Undo back", async () => {
    send.mockReturnValue(resolves({ items: lists.team.items, version: "000000000000001b" }));
    withSaves(<TeamList botId="bot-1" canManage myUserId={7} />);
    expect(screen.getByText("You")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Their email address"), {
      target: { value: "ravi@clinic.test" },
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add" })));
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        version: "000000000000000b",
        change: { op: "add", item: { email: "ravi@clinic.test", role: "editor" } },
      }),
    );
    await act(async () =>
      fireEvent.change(screen.getByLabelText("What they can do: Meera"), {
        target: { value: "viewer" },
      }),
    );
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ change: { op: "edit", id: "8", item: { role: "viewer" } } }),
    );
    act(() => saves.changed.mock.calls.at(-1)![0]());
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ change: { op: "edit", id: "8", item: { role: "editor" } } }),
    );
  });

  it("is read-only for an editor", () => {
    withSaves(<TeamList botId="bot-1" canManage={false} />);
    expect(screen.getByText("Only an owner can change the team.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Their email address")).toBeNull();
    expect(screen.getByLabelText("What they can do: Meera")).toBeDisabled();
  });
});

describe("quick replies", () => {
  it("lets Ally's safety reply be reworded but never turned off or removed", async () => {
    withSaves(<QuickReplies botId="bot-1" canEdit />);
    expect(
      screen.getByText("Safety reply: it can be reworded, never turned off."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn off" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove Crisis" })).toBeNull();
    send.mockReturnValue(
      resolves({ items: lists.quickReplies.items, version: "000000000000001c" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reword" }));
    expect(screen.queryByLabelText("When someone writes")).toBeNull();
    fireEvent.change(screen.getByLabelText("It replies"), {
      target: { value: "Please call 14416 now." },
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save reply" })));
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        change: { op: "edit", id: "crisis-1", item: { responseText: "Please call 14416 now." } },
      }),
    );
  });
});

describe("documents", () => {
  it("removes a library document with Undo that adds it back", async () => {
    send.mockReturnValue(resolves({ items: [], version: "000000000000001d" }));
    withSaves(<DocumentsList botId="bot-1" canEdit />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove Fees" })));
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ version: "000000000000000d", change: { op: "remove", id: "d1" } }),
    );
    act(() => saves.changed.mock.calls[0][0]());
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ change: { op: "add", item: { documentId: "d1" } } }),
    );
  });
});
