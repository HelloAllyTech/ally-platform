import React from "react";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

type Fn = ReturnType<typeof vi.fn>;
const h = vi.hoisted(() => ({
  wc: null as unknown,
  wcRefetch: null as unknown as Fn,
  pending: null as unknown,
  edit: null as unknown as Fn,
  apply: null as unknown as Fn,
  mode: null as unknown as Fn,
  template: null as unknown as Fn,
  sources: null as unknown as Fn,
  propose: null as unknown as Fn,
  applyChange: null as unknown as Fn,
  pane: null as unknown as Fn,
  templates: null as unknown,
  useCase: null as unknown as Fn,
}));

const { USE_CASES } = vi.hoisted(() => ({
  USE_CASES: {
    suggested: null,
    groups: [
      {
        id: "organisations",
        name: "For organisations",
        templates: [
          {
            id: "helpline",
            group: "organisations",
            name: "Helpline and crisis support",
            one_liner: "Answers and callbacks",
            for: "Helplines",
            icon: "helpline",
            purpose: "answer",
            pack: "Mental health safety",
            hand_over: true,
            memory: false,
            lists: [],
            setup: [{ key: "helpline", ask: "What’s your helpline number?", kind: "text" }],
            checkups: 7,
            suggested: false,
          },
        ],
      },
    ],
  },
}));

const { mutation } = vi.hoisted(() => ({
  mutation: (fn: () => (args: unknown) => unknown) => () => [
    (args: unknown) => ({ unwrap: () => fn()(args) }),
    { isLoading: false },
  ],
}));

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetWorkingCopyQuery: () => ({
    data: h.wc,
    isLoading: !h.wc,
    isError: false,
    error: undefined,
    refetch: h.wcRefetch,
  }),
  useGetPendingChangesQuery: (_id: string, opts: { skip?: boolean }) => ({
    data: opts?.skip ? undefined : h.pending,
    refetch: vi.fn(),
  }),
  useEditWorkingCopyFieldMutation: mutation(() => h.edit),
  useApplyWorkingCopyMutation: mutation(() => h.apply),
  useGetBotDraftQuery: () => ({ data: undefined, refetch: vi.fn() }),
  usePatchBotDraftMutation: mutation(() => vi.fn()),
  useSetBuildModeMutation: mutation(() => h.mode),
  useApplyBotTemplateMutation: mutation(() => h.template),
  useAddBotDraftSourcesMutation: mutation(() => h.sources),
  useCreateChatbotDocumentUploadUrlMutation: mutation(() => vi.fn()),
  useGetBotDraftSourcesQuery: () => ({ data: undefined, refetch: vi.fn() }),
  useGetChatbotDocumentsQuery: () => ({ data: [], refetch: vi.fn() }),
  useGetGoLiveChecklistQuery: () => ({ data: undefined, isError: true, refetch: vi.fn() }),
  useGetAccessListQuery: () => ({ data: undefined }),
  useGetSafetyTermsQuery: () => ({ data: undefined }),
  useGetChatbotSettingsQuery: () => ({ data: { overrides: {} }, isError: false }),
  useUpdateChatbotSettingsMutation: mutation(() => vi.fn()),
  useGetChatbotQuery: () => ({ data: undefined }),
  useAcceptSafetyTermsMutation: mutation(() => vi.fn()),
  useRunCrisisCheckMutation: mutation(() => vi.fn()),
  usePublishBotDraftMutation: mutation(() => vi.fn()),
  useProposeBotDraftChangeMutation: mutation(() => h.propose),
  useApplyBotDraftChangeMutation: mutation(() => h.applyChange),
  useGetBotTemplatesQuery: () => ({ data: h.templates, isLoading: false, isError: false }),
  useGetTemplateCatalogueQuery: () => ({ data: USE_CASES, isLoading: false, isError: false }),
  useApplyDraftTemplateMutation: mutation(() => h.useCase),
}));
vi.mock("../create/useDraftEvents", () => ({ useDraftEvents: () => undefined }));
vi.mock("../DraftTestPane", () => ({
  DraftTestPane: (props: Record<string, unknown>) => {
    h.pane(props);
    return <div data-testid="pane">{props.aiOff ? String(props.aiOff) : "test chatbot"}</div>;
  },
}));

/* eslint-disable import/first */
import { BuildScreen } from "../create/BuildScreen";
import { BUILD_COPY } from "../create/copy";
import { TF1_COPY } from "../../AssistantHome/copy/tf1";
/* eslint-enable import/first */

const F = BUILD_COPY.field;

const field = (value: unknown, version = `v-${JSON.stringify(value)}`) => ({ value, version });

const workingCopy = (over: Record<string, unknown> = {}) => ({
  draftId: "d1",
  chatbotId: "b1",
  live: false,
  blank: false,
  touched: true,
  buildMode: "form",
  template: null,
  settingsHash: "hash-0",
  updatedAt: null,
  fields: {
    name: field("Sunrise"),
    assistantName: field("Sunny"),
    introduction: field("Hello"),
    tone: field("warm"),
    instructions: field("Be kind"),
    languages: field(["en"]),
    suggestedQuestions: field(["Fees?"]),
    declineText: field("Call 98450 12345"),
    extraNever: field([]),
    ownerNotes: field(""),
  },
  ...over,
});

const saved = (fieldName: string, value: unknown, version: string, staged = false) => ({
  field: fieldName,
  value,
  version,
  settingsHash: `hash-${version}`,
  staged,
});

const renderScreen = () =>
  render(
    <MemoryRouter>
      <BuildScreen draftId="d1" surface="create" />
    </MemoryRouter>,
  );

const fieldBox = (name: string) => screen.getByTestId(`field-${name}`) as HTMLInputElement;

const typeAndLeave = async (name: string, value: string) => {
  const box = fieldBox(name);
  await act(async () => {
    fireEvent.change(box, { target: { value } });
    fireEvent.blur(box);
  });
};

beforeEach(() => {
  window.localStorage.clear();
  h.wc = workingCopy();
  h.pending = { live: false, changes: [], settingsHash: "hash-0", liveVersion: null };
  h.wcRefetch = vi.fn(async () => undefined);
  h.edit = vi.fn();
  h.apply = vi.fn();
  h.mode = vi.fn(async () => ({ mode: "form", touched: true }));
  h.template = vi.fn();
  h.sources = vi.fn();
  h.propose = vi.fn();
  h.applyChange = vi.fn();
  h.pane = vi.fn();
  h.templates = { templates: [] };
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.useRealTimers());

describe("Create and Build: the form before go-live", () => {
  it("applies an edit as the builder leaves the field, on the field's own version, with no Save button", async () => {
    h.edit.mockResolvedValue(saved("instructions", "Be brief", "v2"));
    renderScreen();
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    await typeAndLeave("instructions", "Be brief");
    expect(h.edit).toHaveBeenCalledWith({
      id: "d1",
      field: "instructions",
      value: "Be brief",
      version: 'v-"Be kind"',
    });
    expect(await screen.findByText(F.saved)).toBeTruthy();
  });

  it("applies after a pause in typing too", async () => {
    h.edit.mockResolvedValue(saved("name", "Sunrise Clinic", "v2"));
    renderScreen();
    await act(async () => {
      fireEvent.change(fieldBox("name"), { target: { value: "Sunrise Clinic" } });
    });
    expect(h.edit).not.toHaveBeenCalled();
    await waitFor(() => expect(h.edit).toHaveBeenCalledTimes(1), { timeout: 2000 });
  });

  it("keeps the typed text on a 409, marked not applied, with Reload and Overwrite", async () => {
    h.edit.mockRejectedValueOnce({
      status: 409,
      data: {
        errorCode: "stale_field",
        details: { field: "instructions", value: "Theirs", version: "v7" },
      },
    });
    renderScreen();
    await typeAndLeave("instructions", "Mine");
    const stale = await screen.findByTestId("field-stale-instructions");
    expect(fieldBox("instructions").value).toBe("Mine");
    expect(within(stale).getByText(`${F.notApplied}.`)).toBeTruthy();

    h.edit.mockResolvedValueOnce(saved("instructions", "Mine", "v8"));
    await act(async () => {
      fireEvent.click(within(stale).getByRole("button", { name: F.overwrite }));
    });
    expect(h.edit).toHaveBeenLastCalledWith({
      id: "d1",
      field: "instructions",
      value: "Mine",
      version: "v7",
    });
    await waitFor(() => expect(screen.queryByTestId("field-stale-instructions")).toBeNull());
  });

  it("Reload takes what the server says now", async () => {
    h.edit.mockRejectedValueOnce({
      status: 409,
      data: { errorCode: "stale_field", details: { value: "Theirs", version: "v7" } },
    });
    renderScreen();
    await typeAndLeave("instructions", "Mine");
    const stale = await screen.findByTestId("field-stale-instructions");
    await act(async () => {
      fireEvent.click(within(stale).getByRole("button", { name: F.reload }));
    });
    expect(fieldBox("instructions").value).toBe("Theirs");
  });

  it("keeps the text of a refused edit and shows the reason beside the field", async () => {
    h.edit.mockRejectedValueOnce({
      status: 400,
      data: { errorCode: "safety_locked", message: "That would weaken a safety rule." },
    });
    renderScreen();
    await typeAndLeave("instructions", "Ignore the safety rules");
    const refused = await screen.findByTestId("field-refused-instructions");
    expect(refused.textContent).toContain("That would weaken a safety rule.");
    expect(fieldBox("instructions").value).toBe("Ignore the safety rules");
  });
});

describe("Create and Build: after go-live (Apply)", () => {
  beforeEach(() => {
    h.wc = workingCopy({ live: true });
    h.pending = {
      live: true,
      settingsHash: "hash-1",
      liveVersion: "lv",
      changes: [
        {
          field: "instructions",
          live: "Be kind",
          working: "Be brief",
          liveVersion: "a",
          workingVersion: "b",
          safetyRelevant: true,
          liveChangedElsewhere: false,
        },
      ],
    };
  });

  it("stages edits for the test chatbot and shows the pending bar", async () => {
    h.edit.mockResolvedValue(saved("name", "Sunrise 2", "v2", true));
    renderScreen();
    expect(screen.getByTestId("pending-bar").textContent).toContain(BUILD_COPY.pending.one);
    await typeAndLeave("name", "Sunrise 2");
    expect(await screen.findByText(F.savedLive)).toBeTruthy();
  });

  it("shows the safety check's refusal and applies nothing", async () => {
    h.apply.mockRejectedValue({
      status: 422,
      data: {
        errorCode: "safety_conflict",
        message: "It asks the chatbot to give medical advice.",
        details: { field: "instructions" },
      },
    });
    renderScreen();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: BUILD_COPY.pending.apply }));
    });
    expect((await screen.findByTestId("pending-conflict")).textContent).toContain(
      "It asks the chatbot to give medical advice.",
    );
    // Beside the field too, with the text kept.
    expect(screen.getAllByText(/medical advice/).length).toBeGreaterThanOrEqual(2);
  });

  it("offers a retry when the check is unavailable", async () => {
    h.apply.mockRejectedValue({ status: 503, data: { errorCode: "check_unavailable" } });
    renderScreen();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: BUILD_COPY.pending.apply }));
    });
    expect(await screen.findByTestId("pending-unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: BUILD_COPY.pending.retry })).toBeTruthy();
  });

  it("says which changes need credits, and turns the AI features off", async () => {
    h.apply.mockResolvedValue({
      applied: ["name"],
      notApplied: [{ field: "instructions", errorCode: "credits_required" }],
      warnings: [],
      liveVersion: "lv2",
      pending: [],
    });
    renderScreen();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: BUILD_COPY.pending.apply }));
    });
    expect(await screen.findByTestId("pending-credits")).toBeTruthy();
    expect(screen.getByTestId("build-credits")).toBeTruthy();
    expect(screen.getAllByText(new RegExp(`${F.notApplied}.`)).length).toBeGreaterThan(0);
  });
});

describe("Create and Build: $0", () => {
  it("keeps name and greeting editable, turns off the safety-relevant fields, Copilot and testing", async () => {
    h.edit.mockRejectedValueOnce({ status: 402, data: { errorCode: "credits_required" } });
    renderScreen();
    await typeAndLeave("instructions", "Be brief");
    expect(await screen.findByTestId("build-credits")).toBeTruthy();
    expect(fieldBox("instructions").disabled).toBe(true);
    expect(fieldBox("instructions").value).toBe("Be brief");
    expect(fieldBox("name").disabled).toBe(false);
    expect(fieldBox("introduction").disabled).toBe(false);
    expect(screen.getByTestId("pane").textContent).toBe(BUILD_COPY.credits.body);
    expect(
      (screen.getByLabelText(BUILD_COPY.copilot.inputLabel) as HTMLInputElement).disabled,
    ).toBe(true);
  });
});

describe("Create and Build: modes", () => {
  it("opens a templated chatbot in the form, and Copilot's conversation survives a reload", async () => {
    h.wc = workingCopy({ buildMode: null, template: { id: "t1", version: 1, name: "Clinic" } });
    window.localStorage.setItem(
      "ally.build.copilot.d1",
      JSON.stringify([
        { id: "c0", kind: "copilot", text: "Earlier Copilot reply" },
        { id: "c1", kind: "you", text: "Earlier builder message" },
      ]),
    );
    renderScreen();
    expect(screen.getByTestId("mode-form").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Earlier Copilot reply")).toBeTruthy();
    expect(screen.getByText("Earlier builder message")).toBeTruthy();
    expect(screen.queryByText(BUILD_COPY.copilot.hello)).toBeNull();
  });

  it("opens a chatbot with content and no stored mode in the form, and a stored mode in that mode", () => {
    h.wc = workingCopy({ blank: false, buildMode: null });
    const first = renderScreen();
    expect(screen.getByTestId("mode-form").getAttribute("aria-pressed")).toBe("true");
    first.unmount();
    h.wc = workingCopy({ blank: false, buildMode: "copilot" });
    renderScreen();
    expect(screen.getByTestId("mode-copilot").getAttribute("aria-pressed")).toBe("true");
  });

  it("switches between Copilot and the form and remembers the choice for this chatbot", async () => {
    renderScreen();
    expect(screen.getByTestId("mode-form").getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      fireEvent.click(screen.getByTestId("mode-copilot"));
    });
    expect(screen.getByTestId("mode-copilot").getAttribute("aria-pressed")).toBe("true");
    expect(h.mode).toHaveBeenCalledWith({ id: "d1", mode: "copilot" });
    expect(screen.getByTestId("copilot").closest("[hidden]")).toBeNull();
    expect(screen.getByTestId("direct-form").closest("[hidden]")).not.toBeNull();
  });

  it("asks before a Copilot change replaces a field being edited in the form", async () => {
    h.wc = workingCopy({ buildMode: "copilot" });
    h.propose.mockResolvedValue({
      refused: false,
      message: "Shorter replies.",
      changes: [{ field: "instructions", before: "Be kind", after: "Be brief" }],
      version: 3,
      fieldVersions: { instructions: 'v-"Be kind"' },
    });
    renderScreen();
    // An unsaved edit in the form (typed, not yet left).
    await act(async () => {
      fireEvent.change(fieldBox("instructions"), { target: { value: "Half typed" } });
    });
    const input = screen.getByLabelText(BUILD_COPY.copilot.inputLabel);
    await act(async () => {
      fireEvent.change(input, { target: { value: "make replies shorter" } });
      fireEvent.submit(input.closest("form")!);
    });
    const proposal = await screen.findByTestId("copilot-proposal");
    await act(async () => {
      fireEvent.click(within(proposal).getByRole("button", { name: BUILD_COPY.copilot.apply }));
    });
    expect(await screen.findByTestId("copilot-confirm")).toBeTruthy();
    expect(h.applyChange).not.toHaveBeenCalled();
    h.applyChange.mockResolvedValue({ eventId: "e1", version: 4 });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: BUILD_COPY.copilot.replace }));
    });
    expect(h.applyChange).toHaveBeenCalledWith({
      id: "d1",
      changes: [{ field: "instructions", before: "Be kind", after: "Be brief" }],
      version: 3,
      fieldVersions: { instructions: 'v-"Be kind"' },
    });
  });

  it("reads a pasted address as a source, and explains a crawl that fails", async () => {
    h.wc = workingCopy({ buildMode: "copilot" });
    h.sources.mockResolvedValue({
      started: null,
      queued: [],
      failure: { errorCode: "crawl_needs_javascript", message: "x" },
      documents: [],
      staged: false,
    });
    renderScreen();
    const input = screen.getByLabelText(BUILD_COPY.copilot.inputLabel);
    await act(async () => {
      fireEvent.change(input, { target: { value: "sunrise.org" } });
      fireEvent.submit(input.closest("form")!);
    });
    expect(h.sources).toHaveBeenCalledWith({ id: "d1", addresses: ["sunrise.org"] });
    expect(await screen.findByText(BUILD_COPY.crawlFailure.crawl_needs_javascript)).toBeTruthy();
  });
});

describe("Create and Build: a new, blank chatbot", () => {
  beforeEach(() => {
    h.wc = workingCopy({
      blank: true,
      touched: false,
      buildMode: null,
      fields: { ...workingCopy().fields, instructions: field(""), introduction: field("") },
    });
    h.templates = {
      templates: [
        {
          id: "lib-helpline",
          version: 1,
          name: "Helpline front door",
          oneLiner: "Answers first questions",
          for: "helplines",
          tone: "warm",
          languages: ["en"],
          suggestedQuestions: [],
          documents: [{ title: "Hours" }, { title: "Services" }],
          lists: [],
          fields: [
            { key: "name", label: "Your organisation's name", kind: "text", required: true },
            { key: "weekends", label: "Open at weekends?", kind: "yes_no", required: false },
          ],
        },
      ],
    };
  });

  it("opens on the start options beside the test chatbot", () => {
    renderScreen();
    expect(screen.getByTestId("start-panel")).toBeTruthy();
    expect(screen.getByTestId("start-template")).toBeTruthy();
    expect(screen.getByTestId("pane")).toBeTruthy();
    fireEvent.click(screen.getByTestId("start-scratch"));
    expect(screen.getByTestId("start-website")).toBeTruthy();
    expect(screen.getByTestId("start-documents")).toBeTruthy();
    expect(screen.getByTestId("start-interview")).toBeTruthy();
  });

  it("applies a template from its setup fields, then opens the form with what is still indexing", async () => {
    h.template.mockResolvedValue({
      applied: true,
      template: { id: "lib-helpline", version: 1, name: "Helpline front door" },
      sourcesIndexing: 2,
      documents: ["k1", "k2"],
      workingCopy: workingCopy({
        template: { id: "lib-helpline", version: 1, name: "Helpline front door" },
      }),
    });
    renderScreen();
    fireEvent.click(screen.getByTestId("start-template"));
    fireEvent.click(screen.getByRole("button", { name: TF1_COPY.create.moreStartingPoints }));
    fireEvent.click(screen.getByTestId("template-lib-helpline"));
    fireEvent.change(screen.getByLabelText("Your organisation's name"), {
      target: { value: "Sunrise" },
    });
    fireEvent.click(screen.getByLabelText(BUILD_COPY.templates.yes));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: BUILD_COPY.templates.apply }));
    });
    expect(h.template).toHaveBeenCalledWith({
      id: "d1",
      templateId: "lib-helpline",
      answers: { name: "Sunrise", weekends: true },
    });
    expect((await screen.findByTestId("template-applied")).textContent).toContain("2 sources");
    expect(h.mode).toHaveBeenCalledWith({ id: "d1", mode: "form", path: "template" });
    expect(screen.getByTestId("direct-form")).toBeTruthy();
  });

  it("hides templates once the server says the chatbot isn't blank", async () => {
    h.template.mockRejectedValue({ status: 409, data: { errorCode: "not_blank" } });
    renderScreen();
    fireEvent.click(screen.getByTestId("start-template"));
    fireEvent.click(screen.getByRole("button", { name: TF1_COPY.create.moreStartingPoints }));
    fireEvent.click(screen.getByTestId("template-lib-helpline"));
    fireEvent.change(screen.getByLabelText("Your organisation's name"), {
      target: { value: "Sunrise" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: BUILD_COPY.templates.apply }));
    });
    expect(await screen.findByText(BUILD_COPY.templates.notBlank)).toBeTruthy();
    expect(screen.queryByTestId("start-template")).toBeNull();
  });

  // TF1 S6: T1's use-case templates weren't in Create, so a template only half-applied via Tools.
  it("Pick a template offers the use-case templates, applied whole to the draft", async () => {
    h.useCase = vi.fn().mockResolvedValue({
      result: { template: { id: "helpline", name: "Helpline and crisis support" } },
      draft: {},
    });
    renderScreen();
    fireEvent.click(screen.getByTestId("start-template"));
    fireEvent.click(screen.getByTestId("template-card-helpline"));
    fireEvent.change(screen.getByRole("textbox", { name: "What’s your helpline number?" }), {
      target: { value: "1800-200-3000" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("template-set-up"));
    });
    expect(h.useCase).toHaveBeenCalledWith({
      draftId: "d1",
      template: "helpline",
      answers: { helpline: "1800-200-3000" },
    });
    expect((await screen.findByTestId("template-applied")).textContent).toContain(
      "Helpline and crisis support",
    );
  });

  it("a template is not offered on a chatbot that isn't blank", () => {
    h.wc = workingCopy({ blank: false, buildMode: null });
    renderScreen();
    expect(screen.queryByTestId("start-panel")).toBeNull();
    expect(screen.queryByTestId("start-template")).toBeNull();
  });

  it("reads a website from the start path and opens Copilot", async () => {
    h.sources.mockResolvedValue({
      started: "https://sunrise.org/",
      queued: [],
      failure: null,
      documents: [],
      staged: false,
    });
    renderScreen();
    fireEvent.click(screen.getByTestId("start-scratch"));
    fireEvent.click(screen.getByTestId("start-website"));
    fireEvent.change(screen.getByLabelText(BUILD_COPY.start.addressLabel), {
      target: { value: "sunrise.org" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: BUILD_COPY.start.read }));
    });
    expect(h.mode).toHaveBeenCalledWith({ id: "d1", mode: "copilot", path: "website" });
    expect(screen.getByTestId("copilot")).toBeTruthy();
  });

  it("explains a crawl that fails at once and stays on the start path", async () => {
    h.sources.mockResolvedValue({
      started: null,
      queued: [],
      failure: { errorCode: "crawl_unreachable", message: "x" },
      documents: [],
      staged: false,
    });
    renderScreen();
    fireEvent.click(screen.getByTestId("start-scratch"));
    fireEvent.click(screen.getByTestId("start-website"));
    fireEvent.change(screen.getByLabelText(BUILD_COPY.start.addressLabel), {
      target: { value: "nowhere.example" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: BUILD_COPY.start.read }));
    });
    expect(await screen.findByText(BUILD_COPY.crawlFailure.crawl_unreachable)).toBeTruthy();
    expect(h.mode).not.toHaveBeenCalled();
  });

  it("the interview opens Copilot with its first question", async () => {
    h.wc = workingCopy({
      blank: true,
      buildMode: null,
      fields: { ...workingCopy().fields, name: field("") },
    });
    renderScreen();
    fireEvent.click(screen.getByTestId("start-scratch"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("start-interview"));
    });
    expect(screen.getByText(BUILD_COPY.copilot.interviewHello)).toBeTruthy();
    expect(screen.getByText(BUILD_COPY.interview[0].ask)).toBeTruthy();
  });
});
