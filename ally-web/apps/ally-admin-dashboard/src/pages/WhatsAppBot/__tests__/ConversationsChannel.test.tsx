import React from "react";

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Chunk 12b: while the dashboard reads the shared store, every thread says which channel it came
 * from, a channel filter appears, bot page visitors are named by their masked email (never a phone),
 * and a bot page thread shows its pre-chat answers. Reading wa_* the screen is exactly as before.
 *
 * (Harness copied from ConversationsTab.test.tsx, whose own assertions are untouched.)
 * The load-bearing assertions there are the PHONE-MASKING ones.
 *
 * These rows hold mental healthcare workers' clinical questions next to their phone numbers, and this
 * screen gets screenshotted. So two properties are asserted directly rather than left to a reader's
 * eye: the list renders only the last four digits, and the full number reaches the screen only after
 * an explicit reveal — which must be a mutation, so RTK Query never refetches it on mount or on cache
 * invalidation and quietly re-emits identifiable data nobody asked for.
 */

// Inlined: vi.mock factories are hoisted above module-scope consts.
vi.mock("@constants", () => ({
  TooltipLocation: { WA_REVEAL_PHONE: "wa_reveal_phone", WA_BLOCK_CONTACT: "wa_block_contact" },
  en: {
    common: { cancel: "Cancel", loading: "Loading…" },
    whatsappBot: {
      corpus: { previousPage: "Previous", nextPage: "Next" },
      conversations: {
        subtitle: "What workers asked.",
        searchPlaceholder: "Search message text",
        columnContact: "Contact",
        columnLast: "Last message",
        columnMessages: "Messages",
        columnLanguage: "Language",
        declinedOnly: "Only unanswered",
        reveal: "Reveal number",
        revealed: "Number revealed",
        revealFailed: "Could not reveal",
        block: "Block",
        unblock: "Unblock",
        blocked: "Blocked",
        blockedBadge: "Blocked",
        blockConfirmTitle: "Block this number?",
        blockConfirmDescription: "Messages will be dropped.",
        empty: "No conversations yet",
        emptySubtitle: "Threads appear here.",
        emptyFiltered: "No conversations match those filters",
        emptyFilteredSubtitle: "Try a wider range.",
        loadError: "Could not load conversations.",
        threadHeading: "Thread",
        numberEnding: "Phone number ending",
        dateFrom: "From",
        dateTo: "To",
        languageFilter: "Language",
        anyLanguage: "Any language",
        outcomeFilter: "Outcome",
        anyOutcome: "Any outcome",
        clearFilters: "Clear filters",
        handledBy: {},
        channelFilter: "Channel",
        anyChannel: "Any channel",
        channel: { whatsapp: "WhatsApp", web: "Bot page" },
        visitor: "Visitor",
        intakeTitle: "Answers before the chat",
        consentGiven: 'Agreed to: "{text}" on {date}',
        eraseVisitor: "Erase this visitor",
        eraseVisitorConfirm: "Erase?",
        visitorErased: "Visitor erased",
        eraseFailed: "Could not erase",
        organisation: "Organisation",
        organisationUnknown: "Unknown",
        organisationUnknownHelp: "Not on a profile",
      },
    },
  },
}));

const revealSpy = vi.fn();
const listQuerySpy = vi.fn();

vi.mock("@api", () => ({
  useGetWaConversationsQuery: (params: unknown) => {
    listQuerySpy(params);
    return mockQueryResult;
  },
  useGetWaConversationLanguagesQuery: () => ({ data: ["en", "hi"] }),
  useRevealWaContactPhoneMutation: () => [revealSpy, { isLoading: false }],
  useBlockWaContactMutation: () => [vi.fn(), { isLoading: false }],
  useUnblockWaContactMutation: () => [vi.fn(), { isLoading: false }],
  useGetWaConversationQuery: () => mockDetail,
  useEraseWebContactMutation: () => [vi.fn(), { isLoading: false }],
  useGetWaCitationQuery: () => ({ data: undefined, isLoading: false, isError: false }),
}));

vi.mock("@components", () => ({
  ActionConfirmationPopup: () => null,
  EmptyState: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <div>
      <span>{title}</span>
      <span>{subtitle}</span>
    </div>
  ),
  // Renders the real column output, which is what the masking assertions read.
  EntityTable: ({
    rows,
    columns,
    actions,
  }: {
    rows: { id: string }[];
    columns: { key: string; render?: (row: unknown) => React.ReactNode }[];
    actions?: { key: string; hidden?: (row: unknown) => boolean }[];
  }) => {
    capturedColumns = columns;
    return (
      <table>
        <tbody>
          {rows.map(row => (
            <tr key={row.id} data-testid="row">
              {columns.map(col => (
                <td key={col.key}>{col.render ? col.render(row) : null}</td>
              ))}
              <td data-testid="actions">
                {(actions ?? [])
                  .filter(action => !action.hidden?.(row))
                  .map(action => action.key)
                  .join(",")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  },
  ListToolbar: () => <div data-testid="toolbar" />,
  ListPagination: () => <div data-testid="pagination" />,
}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  InlineNotification: ({ title }: { title: string }) => <div role="alert">{title}</div>,
  SkeletonText: () => <div data-testid="skeleton" />,
  Tag: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Checkbox: ({ labelText }: { labelText: string }) => <label>{labelText}</label>,
  CarbonDropdown: ({ titleText }: { titleText: string }) => <div>{titleText}</div>,
  DatePicker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DatePickerInput: ({ labelText }: { labelText: string }) => <label>{labelText}</label>,
}));

vi.mock("@components/app-tooltip", () => ({
  AppTooltip: ({ children }: { children?: React.ReactNode }) => children,
  TooltipHint: () => null,
}));

vi.mock("@icons", () => ({
  Chat: () => <span />,
  Eye: () => <span />,
  Unarchive: () => <span />,
  Unpublish: () => <span />,
  DoubleArrowRight: () => <span />,
}));

vi.mock("@utils", () => ({
  formatDate: (v: string) => v,
  formatRelativeTime: () => "2d ago",
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

let capturedColumns: { key: string; sortKey?: string }[] = [];
const lastColumns = () => capturedColumns;

let mockDetail: { data?: unknown; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};

let mockQueryResult: {
  data?: { conversations: unknown[]; count: number };
  isLoading: boolean;
  isError: boolean;
};

const thread = (over: Record<string, unknown> = {}) => ({
  id: "conv-1",
  contactId: "contact-1",
  startedAt: "2026-08-01T00:00:00Z",
  lastMessageAt: "2026-08-02T00:00:00Z",
  messageCount: 4,
  lastLanguage: "hi",
  phoneLast4: "4821",
  consentStatus: "granted",
  blockedAt: null,
  ...over,
});

const { ConversationsTab } = await import("../ConversationsTab");

// A real router rather than a mocked useSearchParams: the open thread is held in the URL now, and a
// stub would assert against the stub instead of the behaviour.
const renderTab = () =>
  render(
    <MemoryRouter>
      <ConversationsTab />
    </MemoryRouter>,
  );

describe("ConversationsTab channels (shared store)", () => {
  beforeEach(() => {
    listQuerySpy.mockClear();
    mockDetail = { data: undefined, isLoading: false, isError: false };
    mockQueryResult = { data: { conversations: [], count: 0 }, isLoading: false, isError: false };
  });

  it("reading wa_*: no badge and no channel filter, exactly as before", () => {
    mockQueryResult.data = { conversations: [thread()], count: 1 };
    renderTab();
    expect(screen.queryByText("WhatsApp")).toBeNull();
    expect(screen.queryByText("Channel")).toBeNull();
    expect(screen.getByLabelText("Phone number ending 4821")).toBeInTheDocument();
  });

  it("reading the shared store: a badge per row, the filter, and bot page visitors by masked email", () => {
    mockQueryResult.data = {
      conversations: [
        thread({ channel: "whatsapp" }),
        thread({
          id: "conv-2",
          contactId: "c-2",
          channel: "web",
          visitor: "a***@example.com",
          phoneLast4: null,
        }),
      ],
      count: 2,
    };
    renderTab();
    const [whatsapp, web] = screen.getAllByTestId("row");
    expect(whatsapp).toHaveTextContent("WhatsApp");
    expect(web).toHaveTextContent("Bot page");
    expect(web).toHaveTextContent("a***@example.com");
    expect(screen.getByText("Channel")).toBeInTheDocument();
    // Reveal and block are about phone numbers: a bot page row offers neither.
    expect(screen.getAllByTestId("actions")[1].textContent).toBe("open");
    expect(screen.getAllByTestId("actions")[0].textContent).toContain("reveal");
  });

  it("shows a bot page thread's pre-chat answers and consent at the top", () => {
    mockDetail = {
      isLoading: false,
      isError: false,
      data: {
        channel: "web",
        visitor: { id: "contact-9", label: "a***@example.com" },
        contact: null,
        conversation: {
          id: "conv-2",
          intake: {
            completedAt: "2026-11-07T10:00:00Z",
            answers: [
              { id: "name", label: "Your name", type: "text", value: "Asha" },
              { id: "ok", label: "Consent", type: "consent", value: "true" },
            ],
            consents: [
              { id: "ok", text: "I agree to be contacted.", acceptedAt: "2026-11-07T10:00:00Z" },
            ],
          },
        },
        messages: [],
      },
    };
    render(
      <MemoryRouter initialEntries={["/?conversation=conv-2"]}>
        <ConversationsTab />
      </MemoryRouter>,
    );
    const answers = screen.getByRole("region", { name: "Answers before the chat" });
    expect(answers).toHaveTextContent("Your name");
    expect(answers).toHaveTextContent("Asha");
    expect(answers).toHaveTextContent(
      'Agreed to: "I agree to be contacted." on 2026-11-07T10:00:00Z',
    );
    expect(screen.getByRole("button", { name: "Erase this visitor" })).toBeInTheDocument();
  });
});
