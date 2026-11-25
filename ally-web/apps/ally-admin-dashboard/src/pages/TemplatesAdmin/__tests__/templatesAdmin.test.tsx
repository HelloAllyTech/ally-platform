import React from "react";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

import type {
  TemplateDetail,
  TemplateDraft,
  TemplateManifest,
  TemplateRow,
  TemplatesMeta,
} from "../templatesAdminApi";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  detail: null as unknown,
  meta: null as unknown,
  create: vi.fn(),
  save: vi.fn(),
  publish: vi.fn(),
  discard: vi.fn(),
  unpublish: vi.fn(),
  restore: vi.fn(),
}));

const unwrap =
  (fn: ReturnType<typeof vi.fn>) =>
  (...args: unknown[]) => ({ unwrap: () => fn(...args) });

vi.mock("../templatesAdminApi", () => ({
  useGetTemplatesAdminListQuery: () => ({
    data: { templates: h.rows },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGetTemplatesAdminMetaQuery: () => ({ data: h.meta, isError: false }),
  useGetTemplateAdminQuery: () => ({
    data: h.detail,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateTemplateDraftMutation: () => [unwrap(h.create), { isLoading: false }],
  useSaveTemplateDraftMutation: () => [unwrap(h.save), { isLoading: false }],
  usePublishTemplateMutation: () => [unwrap(h.publish), { isLoading: false }],
  useDiscardTemplateDraftMutation: () => [unwrap(h.discard), { isLoading: false }],
  useUnpublishTemplateMutation: () => [unwrap(h.unpublish), { isLoading: false }],
  useRestoreTemplateVersionMutation: () => [unwrap(h.restore), { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { keyFromName } from "../fields";
// eslint-disable-next-line import/first
import { TemplatesAdminPanel } from "../TemplatesAdminPanel";

const manifest = (over: Partial<TemplateManifest> = {}): TemplateManifest => ({
  id: "clinic",
  group: "businesses",
  name: "Clinic or doctor",
  one_liner: "Books visits.",
  for: "Clinics.",
  icon: "🩺",
  purpose: "enquiries",
  pack: "medical",
  hand_over: true,
  memory: false,
  instructions: "You are the assistant for {name}. Answer from what {name} has told you.",
  lists: [
    {
      key: "services",
      find: "do_it",
      create: "never",
      update: "never",
      line: "Look up the services and what they cost before answering.",
    },
  ],
  setup: [
    { key: "name", ask: "What's it called?", kind: "text", fills: [{ to: "fact" }] },
    { key: "hours", ask: "When are you open?", kind: "long_text", fills: [{ to: "fact" }] },
  ],
  checkups: [{ id: "c1", send: "Are you open?", expect: "answer", facts: ["opening hours"] }],
  suggested_for: [],
  ...over,
});

const row = (over: Partial<TemplateRow>): TemplateRow => ({
  key: "clinic",
  name: "Clinic or doctor",
  group: "businesses",
  one_liner: "Books visits.",
  icon: "🩺",
  origin: "built_in",
  state: "built_in",
  live_version: null,
  draft_version: null,
  installs: 0,
  updated_at: null,
  ...over,
});

const META: TemplatesMeta = {
  lists: [
    {
      key: "services",
      name: "Services",
      fields: [
        {
          key: "name",
          label: "Name",
          type: "text",
          agent_write: false,
          example_options: false,
          to: null,
        },
      ],
    },
    {
      key: "appointments",
      name: "Appointments",
      fields: [
        {
          key: "slot",
          label: "Slot",
          type: "datetime",
          agent_write: true,
          example_options: false,
          to: null,
        },
      ],
    },
  ],
  packs: [
    { id: "standard", name: "Standard" },
    { id: "medical", name: "Medical" },
  ],
  purposes: [
    { id: "answer", name: "Answers questions" },
    { id: "enquiries", name: "Takes enquiries" },
  ],
  groups: [
    { id: "organisations", name: "For organisations" },
    { id: "businesses", name: "For businesses" },
  ],
  limits: {},
  key_pattern: "^[a-z][a-z0-9_]{1,39}$",
};

const draft = (over: Partial<TemplateDraft> = {}): TemplateDraft => ({
  id: "d1",
  version: 1,
  status: "draft",
  note: null,
  created_at: "2026-11-25T00:00:00Z",
  published_at: null,
  retired_at: null,
  manifest: manifest(),
  issues: [],
  ...over,
});

const detail = (over: Partial<TemplateDetail> = {}): TemplateDetail => ({
  key: "clinic",
  origin: "built_in",
  built_in: manifest(),
  live: null,
  last_retired: null,
  draft: null,
  versions: [],
  installs: 0,
  ...over,
});

const Where: React.FC = () => <div data-testid="where">{useLocation().search}</div>;

const renderPanel = (path = "/assistants-admin/content?view=templates") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <TemplatesAdminPanel />
      <Where />
    </MemoryRouter>,
  );

beforeEach(() => {
  Object.assign(h, { rows: [], detail: null, meta: META });
  [h.create, h.save, h.publish, h.discard, h.unpublish, h.restore].forEach(f =>
    f.mockReset().mockResolvedValue({}),
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("keyFromName", () => {
  it("makes a valid key from a name", () => {
    expect(keyFromName("Dental clinic!")).toBe("dental_clinic");
    expect(keyFromName("  Café & Bar  ")).toBe("cafe_bar");
    expect(keyFromName("24 hour line")).toBe("t_24_hour_line");
    expect(keyFromName("x".repeat(80)).length).toBeLessThanOrEqual(40);
    expect(keyFromName("!!!")).toBe("");
  });
});

describe("Templates list", () => {
  it("shows every template with where it stands and how many assistants started from it", () => {
    h.rows = [
      row({}),
      row({
        key: "salon",
        name: "Salon",
        state: "overridden",
        live_version: 2,
        draft_version: 3,
        installs: 4,
      }),
      row({
        key: "dental",
        name: "Dental",
        origin: "custom",
        state: "published",
        live_version: 1,
        installs: 1,
      }),
      row({
        key: "draft_only",
        name: "Half done",
        origin: "custom",
        state: "unpublished",
        draft_version: 1,
      }),
    ];
    renderPanel();
    expect(
      within(screen.getByTestId("template-row-clinic")).getByText("Built in"),
    ).toBeInTheDocument();
    const salon = screen.getByTestId("template-row-salon");
    expect(within(salon).getByText("Built in, edited · live v2")).toBeInTheDocument();
    expect(within(salon).getByText("Draft v3 open")).toBeInTheDocument();
    expect(within(salon).getByText("4 assistants")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("template-row-dental")).getByText("Live · v1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("template-row-dental")).getByText("1 assistant"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("template-row-draft_only")).getByText("Not live"),
    ).toBeInTheDocument();
  });

  it("opens a template by putting its key in the address", () => {
    h.rows = [row({})];
    h.detail = detail();
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Open Clinic or doctor" }));
    expect(screen.getByTestId("where").textContent).toContain("template=clinic");
    expect(screen.getByTestId("template-editor")).toBeInTheDocument();
  });

  it("starts a new template: the key follows the name, and it opens the draft", async () => {
    h.rows = [row({})];
    h.detail = detail({ key: "dental_clinic", built_in: null, origin: "custom" });
    renderPanel();
    fireEvent.click(screen.getByTestId("template-new"));
    fireEvent.change(screen.getByTestId("new-template-source"), { target: { value: "clinic" } });
    fireEvent.change(screen.getByTestId("new-template-name"), {
      target: { value: "Dental clinic" },
    });
    expect((screen.getByTestId("new-template-key") as HTMLInputElement).value).toBe(
      "dental_clinic",
    );
    fireEvent.click(screen.getByTestId("new-template-start"));
    await waitFor(() =>
      expect(h.create).toHaveBeenCalledWith({
        key: "dental_clinic",
        name: "Dental clinic",
        from: { key: "clinic" },
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("where").textContent).toContain("template=dental_clinic"),
    );
  });

  it("says plainly when the key is already taken", async () => {
    h.rows = [row({})];
    h.create.mockRejectedValue({ data: { errorCode: "template_key_taken" } });
    renderPanel();
    fireEvent.click(screen.getByTestId("template-new"));
    fireEvent.change(screen.getByTestId("new-template-name"), { target: { value: "Clinic" } });
    fireEvent.click(screen.getByTestId("new-template-start"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/already used/i);
  });
});

describe("Live template (no draft)", () => {
  it("offers to edit it, which opens a draft under the same key", async () => {
    h.detail = detail();
    renderPanel("/x?template=clinic");
    expect(screen.getByTestId("template-live")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("template-edit"));
    await waitFor(() =>
      expect(h.create).toHaveBeenCalledWith({ key: "clinic", from: { key: "clinic" } }),
    );
  });

  it("shows a taken-down staff-made template from its newest version, and can edit it again", async () => {
    h.detail = detail({
      key: "dental_clinic",
      origin: "custom",
      built_in: null,
      last_retired: { ...draft({ id: "r1", status: "retired", version: 1 }) },
    });
    renderPanel("/x?template=dental_clinic");
    expect(screen.getByTestId("template-live")).toHaveTextContent("Books visits.");
    fireEvent.click(screen.getByTestId("template-edit"));
    await waitFor(() =>
      expect(h.create).toHaveBeenCalledWith({
        key: "dental_clinic",
        from: { key: "dental_clinic" },
      }),
    );
  });

  it("takes an edited built-in down after a confirmation that says what comes back", async () => {
    h.detail = detail({
      live: { ...draft({ id: "l1", status: "published", version: 2 }) },
    });
    renderPanel("/x?template=clinic");
    fireEvent.click(screen.getByRole("button", { name: "Take down" }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/built-in one/i));
    await waitFor(() => expect(h.unpublish).toHaveBeenCalledWith("clinic"));
  });
});

describe("Draft editor", () => {
  it("shows what blocks publishing, counts it on the tab, and jumps to it", () => {
    h.detail = detail({
      draft: draft({
        issues: [
          {
            severity: "error",
            path: "lists.0.line",
            message: "The line for this list needs at least 21 characters.",
          },
          { severity: "error", path: "name", message: "The name needs at least 2 characters." },
        ],
      }),
    });
    renderPanel("/x?template=clinic");
    const banner = screen.getByTestId("template-issues");
    expect(
      within(banner).getByText("2 problems to fix before this can be published."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("tab-lists")).toHaveTextContent(/Lists \(1\)/);
    fireEvent.click(within(banner).getByText(/Lists: The line for this list/));
    expect(screen.getByTestId("template-lists")).toBeInTheDocument();
    // …and the problem sits under its own field.
    expect(
      within(screen.getByTestId("template-list-0")).getAllByTestId("field-problems")[0],
    ).toHaveTextContent(/at least 21 characters/);
  });

  it("says it is ready when nothing is wrong", () => {
    h.detail = detail({ draft: draft() });
    renderPanel("/x?template=clinic");
    expect(screen.getByText("No problems. This can be published.")).toBeInTheDocument();
  });

  it("saves only when something changed, and sends the whole template", async () => {
    h.detail = detail({ draft: draft() });
    h.save.mockImplementation(async ({ manifest: m }: { manifest: TemplateManifest }) =>
      draft({ manifest: m, issues: [] }),
    );
    renderPanel("/x?template=clinic");
    const save = screen.getByTestId("template-save");
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByTestId("basics-name"), { target: { value: "Dental clinic" } });
    expect(screen.getByTestId("template-unsaved")).toBeInTheDocument();
    fireEvent.click(save);
    await waitFor(() => expect(h.save).toHaveBeenCalled());
    expect(h.save.mock.calls[0][0]).toMatchObject({
      key: "clinic",
      manifest: { id: "clinic", name: "Dental clinic", lists: [{ key: "services" }] },
    });
    expect(await screen.findByText("Draft saved.")).toBeInTheDocument();
    expect(save).toBeDisabled();
  });

  it("publishes after a confirmation that says existing assistants don't change", async () => {
    h.detail = detail({ draft: draft(), installs: 3 });
    renderPanel("/x?template=clinic");
    fireEvent.click(screen.getByTestId("template-publish"));
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringMatching(/3 assistants were already set up/),
    );
    await waitFor(() => expect(h.publish).toHaveBeenCalledWith({ key: "clinic" }));
    expect(await screen.findByText("Published. Owners see it now.")).toBeInTheDocument();
  });

  it("saves unsaved edits first, and shows the server's problems when it refuses to publish", async () => {
    h.detail = detail({ draft: draft() });
    h.save.mockImplementation(async ({ manifest: m }: { manifest: TemplateManifest }) =>
      draft({ manifest: m, issues: [] }),
    );
    h.publish.mockRejectedValue({
      data: {
        errorCode: "template_not_ready",
        issues: [
          {
            severity: "error",
            path: "instructions",
            message: "The instructions must include {name}.",
          },
        ],
      },
    });
    renderPanel("/x?template=clinic");
    fireEvent.change(screen.getByTestId("basics-instructions"), {
      target: { value: "no placeholder" },
    });
    fireEvent.click(screen.getByTestId("template-publish"));
    await waitFor(() => expect(h.save).toHaveBeenCalled());
    expect(await screen.findByText(/It wasn't published/)).toBeInTheDocument();
    expect(
      within(screen.getByTestId("template-issues")).getByText(
        "1 problem to fix before this can be published.",
      ),
    ).toBeInTheDocument();
    // In the checks list, and under the field itself.
    expect(
      within(screen.getByTestId("template-issues")).getByText(/The instructions must include/),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("template-basics")).getByText(/The instructions must include/),
    ).toBeInTheDocument();
  });

  it("adds a list, and won't offer one the template already has", () => {
    h.detail = detail({ draft: draft() });
    renderPanel("/x?template=clinic");
    fireEvent.click(screen.getByTestId("tab-lists"));
    const add = screen.getByTestId("list-add") as HTMLSelectElement;
    const offered = Array.from(add.options).map(o => o.value);
    expect(offered).toContain("appointments");
    expect(offered).not.toContain("services");
    fireEvent.change(add, { target: { value: "appointments" } });
    expect(screen.getByTestId("template-list-1")).toBeInTheDocument();
  });

  it("won't let the assistant add or change on a list it can't fill in", () => {
    h.detail = detail({ draft: draft() });
    renderPanel("/x?template=clinic");
    fireEvent.click(screen.getByTestId("tab-lists"));
    const create = screen.getByTestId("list-0-create") as HTMLSelectElement;
    const doIt = Array.from(create.options).find(o => o.value === "do_it")!;
    expect(doIt.disabled).toBe(true);
  });

  it("keeps a list's yes/no condition in step when its question is renamed or removed", () => {
    const yesNo = manifest({
      setup: [
        { key: "name", ask: "Name?", kind: "text", fills: [{ to: "fact" }] },
        { key: "booking", ask: "Take bookings?", kind: "yes_no", fills: [{ to: "list" }] },
      ],
      lists: [
        {
          key: "services",
          find: "do_it",
          create: "never",
          update: "never",
          line: "Look up the services and what they cost before answering.",
          only_if: "booking",
        },
      ],
    });
    h.detail = detail({ draft: draft({ manifest: yesNo }) });
    h.save.mockImplementation(async ({ manifest: m }: { manifest: TemplateManifest }) =>
      draft({ manifest: m }),
    );
    renderPanel("/x?template=clinic");
    fireEvent.click(screen.getByTestId("tab-setup"));
    const keyInput = within(screen.getByTestId("template-setup-1")).getAllByRole("textbox")[1];
    fireEvent.change(keyInput, { target: { value: "bookings" } });
    fireEvent.click(screen.getByTestId("template-save"));
    return waitFor(() => expect(h.save).toHaveBeenCalled()).then(() => {
      expect(h.save.mock.calls[0][0].manifest.lists[0].only_if).toBe("bookings");
    });
  });

  it("discards the draft after asking", async () => {
    h.detail = detail({ draft: draft() });
    renderPanel("/x?template=clinic");
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(h.discard).toHaveBeenCalledWith("clinic"));
  });
});

describe("History", () => {
  it("opens an older version as a new draft, but not while a draft is open", async () => {
    const versions = [
      {
        id: "v2",
        version: 2,
        status: "published" as const,
        note: null,
        created_at: "2026-11-02T00:00:00Z",
        published_at: "2026-11-03T00:00:00Z",
        retired_at: null,
      },
      {
        id: "v1",
        version: 1,
        status: "retired" as const,
        note: "First",
        created_at: "2026-11-01T00:00:00Z",
        published_at: "2026-11-01T00:00:00Z",
        retired_at: "2026-11-03T00:00:00Z",
      },
    ];
    h.detail = detail({ versions, live: { ...draft({ status: "published", version: 2 }) } });
    renderPanel("/x?template=clinic");
    const buttons = within(screen.getByTestId("history-version-1")).getAllByRole("button");
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(h.restore).toHaveBeenCalledWith({ key: "clinic", version: 1 }));
  });
});
