import React from "react";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

/**
 * Lists on the assistant's home (chunk 5b): the empty state and the guided ready-made setup; the
 * table's search, filters, sort and paging; adding and editing an entry, a refusal at its detail
 * with free times to tap, a version conflict, delete then Undo; details, rules as sentences and
 * the entries a new rule breaks; what the assistant may do; Repeat weekly; switching assistant.
 */
const h = vi.hoisted(() => ({
  lists: { current: [] as unknown[] },
  entries: { current: { records: [] as unknown[], total: 0, next_cursor: null as string | null } },
  queries: [] as unknown[],
  calls: {} as Record<string, ReturnType<typeof vi.fn>>,
  results: {} as Record<string, (arg: unknown) => Promise<unknown>>,
  chatbots: { current: [] as unknown[] },
  catalogue: { current: null as unknown },
}));

const mutation = vi.hoisted(() => (name: string) => () => {
  const g = globalThis as unknown as {
    __lists: {
      calls: Record<string, (a: unknown) => void>;
      results: Record<string, (a: unknown) => Promise<unknown>>;
    };
  };
  const trigger = (arg: unknown) => {
    g.__lists.calls[name]?.(arg);
    const run = g.__lists.results[name] ?? (() => Promise.resolve({}));
    return { unwrap: () => run(arg) };
  };
  return [trigger, { isLoading: false, isFetching: false, originalArgs: undefined }];
});

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetUserListsQuery: () => ({
    data: h.lists.current,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGetReadyMadeListsQuery: () => ({ data: h.catalogue.current }),
  useGetListEntriesQuery: (arg: { query: unknown }) => {
    h.queries.push(arg.query);
    return { data: h.entries.current, isLoading: false, isError: false, refetch: vi.fn() };
  },
  useLazyGetListEntriesQuery: mutation("loadEntries"),
  useLazyGetListEntryQuery: mutation("loadEntry"),
  useLazySearchListContactsQuery: mutation("searchContacts"),
  useInstallReadyMadeListMutation: mutation("install"),
  useUpdateListFieldMutation: mutation("updateField"),
  useAddListFieldMutation: mutation("addField"),
  useArchiveListFieldMutation: mutation("archiveField"),
  useUpdateUserListMutation: mutation("updateList"),
  useCreateUserListMutation: mutation("createList"),
  useAddListRuleMutation: mutation("addRule"),
  useDeleteListRuleMutation: mutation("deleteRule"),
  useSetListAbilitiesMutation: mutation("setAbilities"),
  useCreateListEntryMutation: mutation("create"),
  useUpdateListEntryMutation: mutation("update"),
  useDeleteListEntryMutation: mutation("delete"),
  useRestoreListEntryMutation: mutation("restore"),
  useRepeatWeeklyMutation: mutation("repeat"),
  useGetChatbotsQuery: () => ({ data: { chatbots: h.chatbots.current } }),
}));
vi.mock("react-redux", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDispatch: () => vi.fn(),
}));

// eslint-disable-next-line import/first
import { HOME } from "../copy";
// eslint-disable-next-line import/first
import { testOnlyNotice } from "../TryIt";
// eslint-disable-next-line import/first
import { AssistantSwitcher } from "../ui/AssistantSwitcher";
// eslint-disable-next-line import/first
import { HomeSavesContext } from "../useHomeField";
// eslint-disable-next-line import/first
import { AssistantBlock } from "../userLists/AssistantBlock";
// eslint-disable-next-line import/first
import { DetailsBlock } from "../userLists/DetailsBlock";
// eslint-disable-next-line import/first
import { EntriesTable } from "../userLists/EntriesTable";
// eslint-disable-next-line import/first
import { ListsSection } from "../userLists/ListsSection";
// eslint-disable-next-line import/first
import { RepeatWeekly } from "../userLists/RepeatWeekly";
// eslint-disable-next-line import/first
import { RulesBlock } from "../userLists/RulesBlock";
// eslint-disable-next-line import/first
import { APPOINTMENTS, SLOTS } from "./listsFixtures";

const t = HOME.userLists;
const BOT = { id: "bot-1", name: "Sunrise Mind", connectors: [] } as never;

const CATALOGUE = {
  groups: [
    {
      name: "Appointments and visits",
      items: [
        {
          name: "appointments",
          title: "Appointments",
          one_liner: "For clinics, therapists, salons and consultants.",
          examples: ["What's free on Thursday?", "Book 11:00"],
          lists: [
            {
              key: "slots",
              name: "Slots",
              fields: [{ key: "starts_at", label: "Time", type: "datetime", required: true }],
            },
            {
              key: "appointments",
              name: "Appointments",
              fields: [{ key: "slot", label: "Slot", type: "relation", required: true }],
            },
          ],
          needs_options: [
            {
              list: "appointments",
              field: "service",
              label: "Service",
              examples: ["Consultation", "Follow-up"],
            },
          ],
        },
      ],
    },
  ],
};

const entry = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `e${n}`,
  version: 1,
  title: `Mon 16 Nov 2026, 1${n}:00`,
  data: { slot: `s${n}`, client: `c${n}`, service: "Consultation", status: "booked" },
  display: {
    slot: `Mon 16 Nov 2026, 1${n}:00`,
    client: ["Ananya Rao", "Kabir Shah", "Meera Iyer"][n] ?? "Visitor · 4821",
    service: "Consultation",
    status: "booked",
  },
  contact_id: `c${n}`,
  created_at: "2026-11-14T09:00:00Z",
  updated_at: "2026-11-14T09:00:00Z",
  created_by: n === 1 ? { kind: "agent", conversation_id: "conv-1" } : { kind: "user", you: true },
  ...extra,
});

const refused = (details: Record<string, unknown>) => () =>
  Promise.reject({
    status: 409,
    data: { errorCode: "LIST_REFUSED", message: details.message, details },
  });

const saves = { changed: vi.fn(), status: vi.fn() };
const withSaves = (ui: React.ReactElement) =>
  render(<HomeSavesContext.Provider value={saves}>{ui}</HomeSavesContext.Provider>);

const lastQuery = () => h.queries[h.queries.length - 1] as Record<string, unknown>;

/** Each mutation's calls, made fresh per test; results set by the test. */
const calls = new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
  get: (target, name: string) => (target[name] ??= vi.fn()),
});

beforeEach(() => {
  for (const key of Object.keys(calls)) delete (calls as Record<string, unknown>)[key];
  h.calls = calls;
  h.catalogue.current = CATALOGUE;
  (globalThis as unknown as { __lists: unknown }).__lists = h;
  h.lists.current = [];
  h.entries.current = { records: [entry(0), entry(1), entry(2)], total: 3, next_cursor: null };
  h.queries.length = 0;
  h.results = {};
  h.chatbots.current = [];
  saves.changed.mockReset();
});

describe("no lists yet", () => {
  it("offers a ready-made list or starting from scratch", () => {
    render(<ListsSection bot={BOT} home={{} as never} canEdit canManage go={vi.fn()} />);
    expect(screen.getByText(t.empty.title)).toBeTruthy();
    expect(screen.getByText(t.empty.body)).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(t.empty.readyMade) })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(t.empty.scratch) })).toBeTruthy();
  });

  it("guides a ready-made list: choose installs it, then Make it yours, then times", async () => {
    h.results.install = () => {
      h.lists.current = [SLOTS, APPOINTMENTS];
      return Promise.resolve({ lists: [SLOTS, APPOINTMENTS] });
    };
    h.results.repeat = () => Promise.resolve({ count: 35, skipped: 0, first: [], dry_run: true });
    const view = render(
      <ListsSection bot={BOT} home={{} as never} canEdit canManage go={vi.fn()} tryIt={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t.empty.readyMade) }));
    expect(screen.getByRole("heading", { name: t.setup.title })).toBeTruthy();
    expect(screen.getByText("“What's free on Thursday?”")).toBeTruthy();
    expect(screen.getByText(/Comes with Slots/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `${t.setup.use}: Appointments` }));
    });
    expect(h.calls.install).toHaveBeenCalledWith({ id: "bot-1", name: "appointments" });
    view.rerender(
      <ListsSection bot={BOT} home={{} as never} canEdit canManage go={vi.fn()} tryIt={vi.fn()} />,
    );
    expect(screen.getByRole("heading", { name: "Make Appointments yours" })).toBeTruthy();
    expect(screen.getAllByText(t.setup.example)).toHaveLength(2);

    // Replace the examples with the owner's own, then Next saves them.
    fireEvent.click(screen.getByRole("button", { name: "Remove Follow-up" }));
    fireEvent.change(screen.getByPlaceholderText("Add a service"), {
      target: { value: "Therapy" },
    });
    fireEvent.click(screen.getByRole("button", { name: t.setup.addChoice }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.setup.next }));
    });
    expect(h.calls.updateField).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "service",
        change: { options: { values: ["Consultation", "Therapy"] } },
      }),
    );
    expect(screen.getByRole("heading", { name: t.setup.timesTitle })).toBeTruthy();
    expect(screen.getByRole("button", { name: t.setup.skipForNow })).toBeTruthy();
  });
});

describe("the entries table", () => {
  const table = () =>
    withSaves(<EntriesTable bot={BOT} list={APPOINTMENTS} lists={[SLOTS, APPOINTMENTS]} canEdit />);

  it("shows each entry's details, a status as a pill, and who added it", () => {
    table();
    expect(screen.getByText("Ananya Rao")).toBeTruthy();
    expect(screen.getAllByText("Booked").length).toBe(3);
    expect(screen.getByText(t.table.byAssistant)).toBeTruthy();
    // An empty value is a quiet dash, not "Not set" on every row.
    expect(screen.getAllByText(t.table.blank).length).toBe(3);
  });

  it("searches its text details, filters by a choice, and sorts by any column", async () => {
    table();
    fireEvent.change(screen.getByLabelText("Search Appointments"), { target: { value: "Kab" } });
    await waitFor(() => expect(lastQuery().search).toBe("Kab"));

    fireEvent.click(screen.getByRole("button", { name: /^Status:/ }));
    fireEvent.click(screen.getByRole("option", { name: "Confirmed" }));
    expect(lastQuery().filters).toEqual([{ field: "status", op: "eq", value: "confirmed" }]);

    fireEvent.click(screen.getByRole("button", { name: "Sort by slot" }));
    expect(lastQuery().sort).toBe("slot");
    fireEvent.click(screen.getByRole("button", { name: "Sort by slot" }));
    expect(lastQuery().sort).toBe("-slot");
    expect(lastQuery().limit).toBe(50);
  });

  it("says when nothing matches, with Clear", async () => {
    h.entries.current = { records: [], total: 0, next_cursor: null };
    table();
    fireEvent.change(screen.getByLabelText("Search Appointments"), { target: { value: "zz" } });
    await screen.findByText("Nothing matches “zz”.");
    fireEvent.click(screen.getByRole("button", { name: t.table.clear }));
    await waitFor(() => expect(lastQuery().search).toBeUndefined());
  });

  it("pages 50 at a time with Show more", async () => {
    h.entries.current = { records: [entry(0)], total: 60, next_cursor: "c2" };
    h.results.loadEntries = () =>
      Promise.resolve({ records: [entry(2)], total: 60, next_cursor: null });
    table();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.table.more }));
    });
    expect(h.calls.loadEntries).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ cursor: "c2", limit: 50 }) }),
    );
    expect(screen.getByText("Meera Iyer")).toBeTruthy();
    expect(screen.getByText("2 of 60")).toBeTruthy();
  });

  it("adds an entry; a taken slot is refused at its detail, with free times to tap", async () => {
    h.results.create = refused({
      code: "unique_taken",
      field: "slot",
      message: "That slot is already taken.",
      conflict: { alternatives: [{ id: "s5", title: "Mon 16 Nov 2026, 15:00" }] },
    });
    table();
    fireEvent.click(screen.getByRole("button", { name: t.table.add }));
    const form = screen.getByTestId("entry-form");
    expect(within(form).getByRole("heading", { name: "New entry in Appointments" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: t.form.add }));
    });
    expect(h.calls.create).toHaveBeenCalledWith(
      expect.objectContaining({ key: "appointments", data: { status: "booked" } }),
    );
    expect(within(form).getByText("That slot is already taken.")).toBeTruthy();
    expect(within(form).getByText(t.form.freeNearby)).toBeTruthy();

    h.results.create = () => Promise.resolve({ record: entry(5) });
    fireEvent.click(within(form).getByRole("button", { name: /Mon 16 Nov, 15:00/ }));
    expect((within(form).getByLabelText(/^Slot/) as HTMLInputElement).value).toBe(
      "Mon 16 Nov, 15:00",
    );
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: t.form.add }));
    });
    expect(h.calls.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ slot: "s5" }) }),
    );
  });

  it("edits with the version it read; a conflict offers Reload", async () => {
    h.results.update = refused({
      code: "version_conflict",
      message: "Someone changed this entry just now. Reload and try again.",
    });
    h.results.loadEntry = () => Promise.resolve(entry(0, { version: 2 }));
    table();
    fireEvent.click(screen.getAllByRole("button", { name: /^Edit / })[0]);
    const form = screen.getByTestId("entry-form");
    expect(within(form).getByText(/Added by you on/)).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: /^Status:/ }));
    // From booked it can only move on, not jump to completed.
    expect(within(form).queryByRole("option", { name: "Completed" })).toBeNull();
    fireEvent.click(within(form).getByRole("option", { name: "Confirmed" }));
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: t.form.save }));
    });
    expect(h.calls.update).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: "e0", version: 1, data: { status: "confirmed" } }),
    );
    expect(within(form).getByText(/Someone changed this entry just now/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: t.form.reload }));
    });
    expect(h.calls.loadEntry).toHaveBeenCalledWith(expect.objectContaining({ recordId: "e0" }));
  });

  it("deletes after asking once, and Undo restores it", async () => {
    table();
    fireEvent.click(screen.getAllByRole("button", { name: /^Delete / })[0]);
    const ask = screen.getByTestId("remove-entry");
    await act(async () => {
      fireEvent.click(within(ask).getByRole("button", { name: t.remove.confirm }));
    });
    expect(h.calls.delete).toHaveBeenCalledWith(expect.objectContaining({ recordId: "e0" }));
    expect(saves.changed).toHaveBeenCalledWith(expect.any(Function), t.remove.done);
    saves.changed.mock.calls[0][0]();
    expect(h.calls.restore).toHaveBeenCalledWith(expect.objectContaining({ recordId: "e0" }));
  });

  it("shows why an entry in use can't be deleted", async () => {
    h.results.delete = refused({
      code: "in_use",
      message: "1 entry in Appointments uses this. Cancel or move it first.",
      conflict: { records: [{ id: "a1", title: "Ananya Rao" }] },
    });
    withSaves(<EntriesTable bot={BOT} list={SLOTS} lists={[SLOTS, APPOINTMENTS]} canEdit />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Delete / })[0]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.remove.confirm }));
    });
    expect(
      screen.getByText("1 entry in Appointments uses this. Cancel or move it first."),
    ).toBeTruthy();
    expect(saves.changed).not.toHaveBeenCalled();
  });

  it("shows no changes to someone who can only view", () => {
    withSaves(
      <EntriesTable bot={BOT} list={APPOINTMENTS} lists={[SLOTS, APPOINTMENTS]} canEdit={false} />,
    );
    expect(screen.queryByRole("button", { name: t.table.add })).toBeNull();
    expect(screen.queryAllByRole("button", { name: /^Delete / })).toHaveLength(0);
  });
});

describe("details, rules and the assistant's switches", () => {
  it("adds a detail with a key made from its name; a refused change shows the reason", async () => {
    render(<DetailsBlock botId="bot-1" list={SLOTS} lists={[SLOTS]} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: /Add a detail/ }));
    fireEvent.change(screen.getByLabelText(t.details.name), { target: { value: "Room" } });
    fireEvent.click(screen.getByRole("switch", { name: t.details.neverStore }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.details.save }));
    });
    expect(h.calls.addField).toHaveBeenCalledWith(
      expect.objectContaining({
        field: expect.objectContaining({
          key: "room",
          label: "Room",
          agent_read: false,
          privacy: { masked: false, never_store: true },
        }),
      }),
    );

    h.results.updateField = refused({
      code: "invalid_value",
      field: "duration",
      message: "Duration isn't valid: its type can't change while entries have a value for it.",
    });
    fireEvent.click(screen.getByRole("button", { name: "Change Duration" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.details.save }));
    });
    expect(screen.getByText(/its type can't change while entries have a value/)).toBeTruthy();
  });

  it("locks Whose entry is this? once the list has entries, and says why", () => {
    render(
      <DetailsBlock botId="bot-1" list={APPOINTMENTS} lists={[SLOTS, APPOINTMENTS]} canEdit />,
    );
    expect(screen.getByText(t.details.whoseLocked)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Whose entry is this\?/ })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("shows rules as sentences, and the entries a new rule breaks, each to open", async () => {
    h.results.addRule = refused({
      code: "invalid_value",
      message: "The rule isn't valid: 2 entries already break it.",
      conflict: {
        records: [
          { id: "e0", title: "Mon 16 Nov 2026, 10:00" },
          { id: "e1", title: "Mon 16 Nov 2026, 11:00" },
        ],
      },
    });
    h.results.loadEntry = () => Promise.resolve(entry(0));
    render(<RulesBlock bot={BOT} list={APPOINTMENTS} lists={[SLOTS, APPOINTMENTS]} canEdit />);
    expect(screen.getByText("Only one entry per slot.")).toBeTruthy();
    expect(screen.getByText("So two people can't book the same slot.")).toBeTruthy();
    expect(screen.getByText("Booked can move to confirmed or cancelled.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Add a rule/ }));
    expect(
      screen.getByRole("button", { name: /Not counting entries whose\s+Count every entry/ }),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.rules.save }));
    });
    expect(
      screen.getByText("2 entries already break this rule. Change them first, or adjust the rule."),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open Mon 16 Nov 2026, 10:00" }));
    });
    expect(h.calls.loadEntry).toHaveBeenCalledWith(expect.objectContaining({ recordId: "e0" }));
    expect(screen.getByTestId("entry-form")).toBeTruthy();
  });

  it("sets Do it or Never per action, and notes the first time Add goes on", async () => {
    render(
      <AssistantBlock botId="bot-1" list={APPOINTMENTS} lists={[SLOTS, APPOINTMENTS]} canEdit />,
    );
    const add = screen.getByRole("radiogroup", { name: t.assistant.add });
    await act(async () => {
      fireEvent.click(within(add).getByRole("radio", { name: t.assistant.doIt }));
    });
    expect(h.calls.setAbilities).toHaveBeenCalledWith({
      id: "bot-1",
      key: "appointments",
      create: "do_it",
    });
    expect(screen.getByText(t.assistant.firstNote)).toBeTruthy();
  });

  it("hides Add and Change when no detail lets the assistant fill it in", () => {
    render(<AssistantBlock botId="bot-1" list={SLOTS} lists={[SLOTS]} canEdit />);
    expect(screen.queryByRole("radiogroup", { name: t.assistant.add })).toBeNull();
    expect(screen.getByText(t.assistant.noFill)).toBeTruthy();
  });
});

describe("Repeat weekly", () => {
  it("counts net of what's there, with the other details for each one", async () => {
    h.results.repeat = () =>
      Promise.resolve({ count: 32, skipped: 3, first: ["Mon 16 Nov 2026, 10:00"], dry_run: true });
    render(
      <RepeatWeekly
        bot={BOT}
        list={SLOTS}
        lists={[SLOTS]}
        field={SLOTS.fields[0]}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByText(t.repeat.forEach)).toBeTruthy();
    expect((screen.getByLabelText("Duration") as HTMLInputElement).value).toBe("50");
    fireEvent.change(screen.getByLabelText("Practitioner"), { target: { value: "Dr Rao" } });
    await screen.findByText(/This adds 32 slots\./);
    expect(screen.getByText(/3 are already there, so they're skipped\./)).toBeTruthy();
    expect(screen.getByText("Mon 16 Nov, 10:00")).toBeTruthy();
    expect(h.calls.repeat).toHaveBeenLastCalledWith(
      expect.objectContaining({
        dry_run: true,
        values: { practitioner: "Dr Rao", duration: 50, open: true },
      }),
    );
  });

  it("waits for a needed detail before it adds anything", () => {
    const tables = {
      ...SLOTS,
      key: "tables",
      name: "Tables",
      fields: [
        ...SLOTS.fields,
        { ...SLOTS.fields[1], key: "table", label: "Table", required: true, position: 5 },
      ],
    } as never;
    render(
      <RepeatWeekly
        bot={BOT}
        list={tables}
        lists={[tables]}
        field={SLOTS.fields[0]}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByText("Fill in table first.")).toBeTruthy();
    expect(screen.getByRole("button", { name: t.repeat.add })).toHaveProperty("disabled", true);
  });
});

describe("Try it and switching assistant", () => {
  it("says a Try it write wasn't saved", () => {
    expect(testOnlyNotice({ previewWrite: true })[0]).toMatchObject({
      role: "notice",
      text: "Test only: this wasn't saved.",
    });
    expect(testOnlyNotice({ previewWrite: false })).toEqual([]);
  });

  const Where = () => {
    const at = useLocation();
    return <p data-testid="at">{`${at.pathname}${at.search}`}</p>;
  };
  const switcher = () =>
    render(
      <MemoryRouter initialEntries={["/chatbots/bot-1?section=lists"]}>
        <Routes>
          <Route
            path="/chatbots/:botId"
            element={
              <>
                <AssistantSwitcher bot={BOT} section="lists" phone={false} />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

  it("shows only with more than one assistant", () => {
    h.chatbots.current = [BOT];
    switcher();
    expect(screen.queryByRole("button", { name: t.switcher.label })).toBeNull();
  });

  it("lists the owner's assistants with their channels, and keeps the section", () => {
    h.chatbots.current = [
      BOT,
      { id: "bot-2", name: "Glow Salon", connectors: [{ typeLabel: "WhatsApp" }] },
    ];
    switcher();
    expect(screen.getByRole("tooltip").textContent).toBe(t.switcher.label);
    fireEvent.click(screen.getByRole("button", { name: t.switcher.label }));
    expect(screen.getByRole("menuitem", { name: /Glow Salon\s*WhatsApp/ })).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: /Sunrise Mind\s*You're here · Not shared yet/ }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /Glow Salon/ }));
    expect(screen.getByTestId("at").textContent).toBe("/chatbots/bot-2?section=lists");
  });
});
