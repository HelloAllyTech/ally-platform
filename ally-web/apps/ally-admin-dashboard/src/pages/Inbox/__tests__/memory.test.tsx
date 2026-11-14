import React from "react";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

/**
 * Memory (chunk 8a): what the assistant remembers beside a chat, Forget, Edit and Forget this
 * person for editors, the off state, the switch in How it works, and Try it's line.
 */
const h = vi.hoisted(() => ({
  memory: { current: null as unknown },
  failed: { current: false },
  forget: vi.fn(),
  edit: vi.fn(),
  forgetPerson: vi.fn(),
  save: vi.fn(),
}));
const unwrapped = (fn: (arg: unknown) => unknown) => (arg: unknown) => ({
  unwrap: () => Promise.resolve().then(() => fn(arg)),
});
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetPersonMemoryQuery: () => ({
    data: h.failed.current ? undefined : h.memory.current,
    isLoading: false,
    isError: h.failed.current,
    refetch: vi.fn(),
  }),
  useForgetMemoryLineMutation: () => [unwrapped(h.forget), { isLoading: false }],
  useEditMemoryLineMutation: () => [unwrapped(h.edit), { isLoading: false }],
  useForgetPersonMutation: () => [unwrapped(h.forgetPerson), { isLoading: false }],
  useSaveHomeFieldMutation: () => [unwrapped(h.save)],
}));
vi.mock("react-redux", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDispatch: () => vi.fn(),
}));

// eslint-disable-next-line import/first
import { HOME } from "../../AssistantHome/copy";
// eslint-disable-next-line import/first
import { MemorySettings } from "../../AssistantHome/sections/MemorySettings";
// eslint-disable-next-line import/first
import { testOnlyNotice } from "../../AssistantHome/TryIt";
// eslint-disable-next-line import/first
import { INBOX } from "../copy";
// eslint-disable-next-line import/first
import { MemoryPanel } from "../MemoryPanel";

const t = INBOX.memory;
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

const line = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  section: "preferences",
  text: "prefers evenings",
  saidAt: "2026-11-12T10:00:00.000Z",
  sourceKind: "person",
  sourceMessageId: "m1",
  sourceConversationId: "c1",
  ...over,
});

const panel = (canEdit = true, onOpenSource = vi.fn()) => {
  render(
    <MemoryRouter>
      <MemoryPanel
        chatbotId="b1"
        contactId="p1"
        conversationId="c1"
        canEdit={canEdit}
        onOpenSource={onOpenSource}
      />
    </MemoryRouter>,
  );
  return onOpenSource;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.failed.current = false;
  h.memory.current = {
    on: true,
    name: "Rahul",
    lines: [
      line(),
      line({ id: "e2", section: "open_items", text: "waiting to hear about fees" }),
      line({ id: "e3", section: "context", text: "comes with his mother", sourceKind: "owner" }),
    ],
  };
});

describe("What your assistant remembers", () => {
  it("shows each line by section, open items first, with its date and source", () => {
    const open = panel();
    expect(screen.getByRole("heading", { name: "What your assistant remembers about Rahul" }));
    const headings = screen.getAllByRole("heading", { level: 4 }).map(n => n.textContent);
    expect(headings).toEqual(["Still open", "Preferences", "Context"]);
    expect(
      screen.getAllByTestId("memory-line").map(n => n.querySelector("p")?.textContent),
    ).toEqual(["waiting to hear about fees", "prefers evenings", "comes with his mother"]);
    expect(screen.getByText(/Changed by your team/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "From their message on 12 Nov" })[0]);
    expect(open).toHaveBeenCalledWith("c1", "m1");
  });

  it("forgets a line", async () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Forget “prefers evenings”" }));
    await waitFor(() => expect(h.forget).toHaveBeenCalledWith({ chatbotId: "b1", id: "e1" }));
    expect(await screen.findByText(t.forgotten)).toBeTruthy();
  });

  it("edits a line, and shows why an edit was refused", async () => {
    panel();
    const row = screen.getAllByTestId("memory-line")[1];
    fireEvent.click(within(row).getByRole("button", { name: t.edit }));
    fireEvent.change(within(row).getByRole("textbox", { name: t.edit }), {
      target: { value: "prefers late evenings" },
    });
    fireEvent.click(within(row).getByRole("button", { name: t.save }));
    await waitFor(() =>
      expect(h.edit).toHaveBeenCalledWith({
        chatbotId: "b1",
        id: "e1",
        text: "prefers late evenings",
      }),
    );

    h.edit.mockImplementation(() => {
      throw { data: { code: "never_store" } };
    });
    fireEvent.click(within(row).getByRole("button", { name: t.edit }));
    fireEvent.change(within(row).getByRole("textbox", { name: t.edit }), {
      target: { value: "PIN 1234" },
    });
    fireEvent.click(within(row).getByRole("button", { name: t.save }));
    expect(await within(row).findByRole("alert")).toHaveProperty("textContent", t.neverStore);
  });

  it("forgets the person after one confirmation; Keep does nothing", async () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: t.forgetPerson }));
    expect(screen.getByRole("heading", { name: "Forget everything about Rahul?" })).toBeTruthy();
    expect(screen.getByText(t.confirmBody)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.keep }));
    expect(h.forgetPerson).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: t.forgetPerson }));
    fireEvent.click(screen.getByRole("button", { name: t.confirm }));
    await waitFor(() =>
      expect(h.forgetPerson).toHaveBeenCalledWith({ chatbotId: "b1", contactId: "p1" }),
    );
    expect(await screen.findByText(t.forgotPerson)).toBeTruthy();
  });

  it("viewers read, and can't forget or edit", () => {
    panel(false);
    expect(screen.getAllByTestId("memory-line")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: t.edit })).toBeNull();
    expect(screen.queryByRole("button", { name: /Forget/ })).toBeNull();
  });

  it("with memory off says so, with the way to the switch", () => {
    h.memory.current = { on: false, name: null, lines: [] };
    panel();
    expect(screen.getByTestId("memory-off").textContent).toContain(t.off);
    expect(screen.getByRole("link", { name: t.turnOn }).getAttribute("href")).toBe(
      "/chatbots/b1?section=how",
    );
    expect(screen.getByRole("heading", { name: t.titleNoName })).toBeTruthy();
  });

  it("with memory on and nothing yet, says notes appear as they chat", () => {
    h.memory.current = { on: true, name: null, lines: [] };
    panel();
    expect(screen.getByText(t.empty)).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.forgetPerson })).toBeNull();
  });

  it("a failed load offers to try again", () => {
    h.failed.current = true;
    panel();
    expect(screen.getByRole("alert").textContent).toContain(t.loadFailed);
  });
});

describe("Remember people between chats, in How it works", () => {
  const home = (memory: unknown, canEdit = true) =>
    ({
      canEdit,
      fields: { memory: { value: memory, version: "000000000000000a" } },
    }) as never;

  it("turns memory on, and shows the defaults that can't be removed", async () => {
    render(
      <MemorySettings
        botId="b1"
        home={home({ on: false, neverStore: [], defaults: ["Payment details", "Symptoms"] })}
        canEdit
      />,
    );
    expect(screen.getByText("Payment details")).toBeTruthy();
    expect(screen.getByText("Symptoms")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Payment details/ })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: /Remember people between chats/ }));
    });
    await waitFor(() =>
      expect(h.save).toHaveBeenCalledWith(
        expect.objectContaining({
          field: "memory",
          value: { on: true, neverStore: [], defaults: ["Payment details", "Symptoms"] },
        }),
      ),
    );
  });

  it("is read-only for a viewer", () => {
    render(
      <MemorySettings
        botId="b1"
        home={home({ on: true, neverStore: ["Religion"], defaults: [] }, false)}
        canEdit={false}
      />,
    );
    expect(
      (screen.getByRole("switch", { name: /Remember people between chats/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: HOME.memory.add })).toBeNull();
  });

  it("shows nothing when ally-be doesn't send the field", () => {
    const { container } = render(
      <MemorySettings botId="b1" home={{ canEdit: true, fields: {} } as never} canEdit />,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("Try it", () => {
  it("says what it would remember, and that it wasn't saved", () => {
    expect(testOnlyNotice({ wouldRemember: ["prefers evenings"] }).map(n => n.text)).toEqual([
      "Would remember: prefers evenings",
      HOME.userLists.tryIt.testOnly,
    ]);
    expect(testOnlyNotice({})).toEqual([]);
  });
});

describe("the copy", () => {
  it.each([...strings(INBOX.memory), ...strings(HOME.memory)])("is the deck's: %s", line =>
    expect(DECK).toContain(line),
  );
});
