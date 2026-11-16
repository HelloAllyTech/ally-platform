import React from "react";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

/**
 * Tools (chunk 8a): the Lists section renamed, with the assistant's own tools (its pages, memory,
 * hand over) as tabs before the lists; a list's choices always in view; Rename and Delete list,
 * with Undo, and a refusal's reason.
 */
const h = vi.hoisted(() => ({
  lists: { current: [] as unknown[] },
  // Stable across renders, as a real query's data is.
  entries: { records: [] as unknown[], total: 0, next_cursor: null as string | null },
  how: { search: { documents: 12 } },
  calls: {} as Record<string, ReturnType<typeof vi.fn>>,
  results: {} as Record<string, (arg: unknown) => Promise<unknown>>,
}));
const mutation = vi.hoisted(() => (name: string) => () => {
  const g = globalThis as unknown as {
    __tools: {
      calls: Record<string, (a: unknown) => void>;
      results: Record<string, (a: unknown) => Promise<unknown>>;
    };
  };
  const trigger = (arg: unknown) => {
    g.__tools.calls[name]?.(arg);
    const run = g.__tools.results[name] ?? (() => Promise.resolve({}));
    return { unwrap: () => run(arg) };
  };
  return [trigger, { isLoading: false }];
});
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetUserListsQuery: () => ({
    data: h.lists.current,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGetReadyMadeListsQuery: () => ({ data: null }),
  useGetHowItWorksQuery: () => ({ data: h.how }),
  useGetListEntriesQuery: () => ({
    data: h.entries,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useLazyGetListEntriesQuery: mutation("loadEntries"),
  useLazyGetListEntryQuery: mutation("loadEntry"),
  useLazySearchListContactsQuery: mutation("searchContacts"),
  useUpdateListFieldMutation: mutation("updateField"),
  useAddListFieldMutation: mutation("addField"),
  useArchiveListFieldMutation: mutation("archiveField"),
  useUpdateUserListMutation: mutation("updateList"),
  useDeleteUserListMutation: mutation("deleteList"),
  useRestoreUserListMutation: mutation("restoreList"),
  useCreateUserListMutation: mutation("createList"),
  useAddListRuleMutation: mutation("addRule"),
  useDeleteListRuleMutation: mutation("deleteRule"),
  useSetListAbilitiesMutation: mutation("setAbilities"),
  useCreateListEntryMutation: mutation("create"),
  useUpdateListEntryMutation: mutation("update"),
  useDeleteListEntryMutation: mutation("delete"),
  useRestoreListEntryMutation: mutation("restore"),
  useRepeatWeeklyMutation: mutation("repeat"),
  useSaveHomeFieldMutation: mutation("saveField"),
}));
vi.mock("react-redux", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDispatch: () => vi.fn(),
}));

// eslint-disable-next-line import/first
import { HOME } from "../copy";
// eslint-disable-next-line import/first
import { HomeSavesContext } from "../useHomeField";
// eslint-disable-next-line import/first
import { ListsSection } from "../userLists/ListsSection";
// eslint-disable-next-line import/first
import { APPOINTMENTS, SLOTS } from "./listsFixtures";

const t = HOME.userLists;
const BOT = { id: "bot-1", name: "Sunrise Mind", connectors: [] } as never;
const HOME_VIEW = {
  canEdit: true,
  fields: {
    memory: {
      value: { on: true, neverStore: [], defaults: ["Payment details"] },
      version: "000000000000000a",
    },
  },
} as never;
const DECK = readFileSync(
  resolve(__dirname, "../../../../../../../docs/agents-v2/ONBOARDING-COPY.md"),
  "utf8",
);
const strings = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : value && typeof value === "object"
      ? Object.values(value).flatMap(strings)
      : [];

const changed = vi.fn();
const go = vi.fn();
const show = (canEdit = true) =>
  render(
    <HomeSavesContext.Provider value={{ changed }}>
      <ListsSection bot={BOT} home={HOME_VIEW} canEdit={canEdit} canManage={canEdit} go={go} />
    </HomeSavesContext.Provider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.lists.current = [SLOTS, { ...APPOINTMENTS, record_count: 3 }];
  h.calls = {
    updateList: vi.fn(),
    deleteList: vi.fn(),
    restoreList: vi.fn(),
  };
  h.results = {};
  (globalThis as unknown as { __tools: unknown }).__tools = h;
});

describe("Tools", () => {
  it("is called Tools, with the assistant's own tools before the lists", () => {
    show();
    expect(screen.getByRole("heading", { name: t.title })).toBeTruthy();
    const tabs = screen.getAllByRole("tab").map(tab => tab.textContent);
    expect(tabs).toEqual([
      "Your pages",
      `Memory${t.tools.on}`,
      "Hand over",
      "Slots3",
      "Appointments3",
    ]);
    expect(screen.getByRole("button", { name: t.tools.add })).toBeTruthy();
  });

  it("shows what each of its own tools does, and where it's changed", () => {
    show();
    fireEvent.click(screen.getByRole("tab", { name: /Your pages/ }));
    expect(screen.getByText("12 pages")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.tools.pagesManage }));
    expect(go).toHaveBeenCalledWith("knows");

    fireEvent.click(screen.getByRole("tab", { name: /Memory/ }));
    expect(screen.getByRole("switch", { name: /Remember people between chats/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.tools.memoryInbox }));
    expect(go).toHaveBeenCalledWith("conversations");

    fireEvent.click(screen.getByRole("tab", { name: /Hand over/ }));
    expect(screen.getByText(t.tools.handoverBody)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.tools.handoverChange }));
    expect(go).toHaveBeenCalledWith("share");
  });

  it("keeps a list's choices in view, not its statuses", () => {
    show();
    fireEvent.click(screen.getByRole("tab", { name: /Appointments/ }));
    const card = screen.getByTestId("list-choices");
    expect(card.textContent).toContain("Your service choices");
    expect(card.textContent).toContain("Consultation");
    expect(card.textContent).toContain("Follow-up");
    expect(card.textContent).not.toContain("Booked");
    expect(screen.getByRole("button", { name: t.choices.edit })).toBeTruthy();
  });

  it("says where a booked list is booked, and how to let the assistant book it", () => {
    h.lists.current = [
      SLOTS,
      { ...APPOINTMENTS, abilities: { find: "do_it", create: "do_it", update: "never" } },
    ];
    const { unmount } = show();
    fireEvent.click(screen.getByRole("tab", { name: /Slots/ }));
    fireEvent.click(screen.getByRole("button", { name: /What your assistant can do/ }));
    expect(screen.getByTestId("list-booked-through").textContent).toBe(
      "Your assistant books these through Appointments: each booking is added there.",
    );
    unmount();
    h.lists.current = [SLOTS, APPOINTMENTS];
    show();
    fireEvent.click(screen.getByRole("tab", { name: /Slots/ }));
    fireEvent.click(screen.getByRole("button", { name: /What your assistant can do/ }));
    expect(screen.getByTestId("list-booked-through").textContent).toBe(
      "To let your assistant book these, turn on Add entries in Appointments.",
    );
  });

  it("renames a list", async () => {
    show();
    fireEvent.click(screen.getByRole("tab", { name: /Appointments/ }));
    fireEvent.click(screen.getByRole("button", { name: "More for Appointments" }));
    fireEvent.click(screen.getByRole("menuitem", { name: t.listMenu.rename }));
    fireEvent.change(screen.getByRole("textbox", { name: t.listMenu.name }), {
      target: { value: "Sessions" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.listMenu.save }));
    });
    expect(h.calls.updateList).toHaveBeenCalledWith({
      id: "bot-1",
      key: "appointments",
      name: "Sessions",
    });
  });

  it("deletes a list after one confirmation, with Undo", async () => {
    show();
    fireEvent.click(screen.getByRole("tab", { name: /Appointments/ }));
    fireEvent.click(screen.getByRole("button", { name: "More for Appointments" }));
    fireEvent.click(screen.getByRole("menuitem", { name: t.listMenu.delete }));
    expect(screen.getByRole("heading", { name: "Delete Appointments?" })).toBeTruthy();
    expect(screen.getByText("It goes with its 3 entries. You can undo this.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.listMenu.delete }));
    });
    expect(h.calls.deleteList).toHaveBeenCalledWith({ id: "bot-1", key: "appointments" });
    expect(changed).toHaveBeenCalledWith(expect.any(Function), "Appointments deleted.");
    changed.mock.calls[0][0]();
    expect(h.calls.restoreList).toHaveBeenCalledWith({ id: "bot-1", listId: "l2" });
  });

  it("offers to delete the lists that link to it too, and Undo brings them all back", async () => {
    show();
    fireEvent.click(screen.getByRole("tab", { name: /Slots/ }));
    fireEvent.click(screen.getByRole("button", { name: "More for Slots" }));
    fireEvent.click(screen.getByRole("menuitem", { name: t.listMenu.delete }));
    expect(screen.getByRole("heading", { name: "Delete Slots and Appointments?" })).toBeTruthy();
    expect(
      screen.getByText(
        "Deleting Slots also deletes Appointments, which uses it. That's 6 entries in all. You can undo this.",
      ),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.listMenu.deleteEverything }));
    });
    expect(h.calls.deleteList).toHaveBeenCalledWith({
      id: "bot-1",
      key: "slots",
      withLinked: true,
    });
    expect(changed).toHaveBeenCalledWith(expect.any(Function), "Slots and Appointments deleted.");
    await act(async () => {
      changed.mock.calls[0][0]();
    });
    await waitFor(() => expect(h.calls.restoreList).toHaveBeenCalledTimes(2));
    expect(h.calls.restoreList.mock.calls.map(c => (c[0] as { listId: string }).listId)).toEqual([
      SLOTS.id,
      "l2",
    ]);
  });

  it("shows why a delete failed, and Keep changes nothing", async () => {
    h.results.deleteList = () =>
      Promise.reject({ data: { message: "Someone changed this list just now." } });
    show();
    fireEvent.click(screen.getByRole("tab", { name: /Appointments/ }));
    fireEvent.click(screen.getByRole("button", { name: "More for Appointments" }));
    fireEvent.click(screen.getByRole("menuitem", { name: t.listMenu.delete }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.listMenu.delete }));
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Someone changed this list just now."),
    );
    fireEvent.click(screen.getByRole("button", { name: t.listMenu.keep }));
    expect(changed).not.toHaveBeenCalled();
  });

  it("is read-only for a viewer: no menu, no Edit", () => {
    show(false);
    fireEvent.click(screen.getByRole("tab", { name: /Appointments/ }));
    expect(screen.queryByRole("button", { name: "More for Appointments" })).toBeNull();
    expect(screen.queryByRole("button", { name: t.choices.edit })).toBeNull();
    expect(screen.queryByRole("button", { name: t.tools.add })).toBeNull();
  });
});

describe("the copy", () => {
  it.each([
    ...strings(t.tools),
    ...strings(t.listMenu),
    ...strings(t.choices),
    t.assistant.bookedThrough,
    t.assistant.bookThroughOff,
    t.title,
    t.subtitle,
    t.help,
    HOME.memory.movedToTools,
    HOME.memory.openTools,
  ])("is the deck's: %s", line => expect(DECK).toContain(line));
});
