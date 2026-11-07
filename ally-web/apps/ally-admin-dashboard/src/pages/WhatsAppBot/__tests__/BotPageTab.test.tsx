import React from "react";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Settings → Bot page (chunk 12b): the link and its QR code, branding with a live phone preview,
 * who may open it (public only while the platform allows it), the questions before the chat, and
 * suggested questions — and viewers can look but not change anything.
 */

const save = vi.fn();
const addAccess = vi.fn();

const view = (over: Record<string, unknown> = {}) => ({
  saved: true,
  status: "on",
  slug: "sunrise-mind",
  access: "invite",
  link: "http://localhost:8081/b/sunrise-mind",
  publicAllowed: false,
  live: { ok: true },
  dailyCapReached: false,
  settings: {
    branding: {
      logoUrl: null,
      accentColour: "#0F766E",
      title: "Sunrise Mind",
      subtitle: "Questions about our clinic",
      assistantName: "Sunny",
      avatarUrl: null,
      disclaimer: "Not a crisis service.",
      footerLink: null,
    },
    suggestedQuestions: ["What are your fees?"],
    prechat: [
      { id: "name", label: "Your name", type: "text", required: true },
      {
        id: "reason",
        label: "Reason",
        type: "choice",
        required: true,
        options: ["Therapy", "Workshops"],
      },
    ],
    limits: { messagesPerVisitorPerHour: 30, maxMessageChars: 1000, dailyCapPerBot: 500 },
    language: "auto",
  },
  ...over,
});

let pageResult: {
  data: ReturnType<typeof view>;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};

vi.mock("@constants", async () => ({
  en: (await import("../../../constants/en")).en,
  TooltipLocation: {},
}));
vi.mock("@components", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@components/types", () => ({
  ButtonVariant: { PRIMARY: "primary", SECONDARY: "secondary", TERTIARY: "tertiary" },
}));
vi.mock("@utils", () => ({ formatRelativeTime: () => "just now" }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async (text: string) => `data:image/png;qr,${text}`) },
}));
vi.mock("@api", () => ({
  useGetBotPageQuery: () => pageResult,
  useUpdateBotPageMutation: () => [
    (args: unknown) => {
      save(args);
      return { unwrap: async () => ({}) };
    },
    { isLoading: false },
  ],
  useLazyCheckBotPageSlugQuery: () => [vi.fn(), { data: undefined, isFetching: false }],
  useCreateBotPageLogoUrlMutation: () => [vi.fn()],
  useGetBotPageAccessQuery: () => ({
    data: { entries: [{ id: "e1", kind: "email", value: "asha@example.com", label: null }] },
    isLoading: false,
    isError: false,
    refetch: () => undefined,
  }),
  useAddBotPageAccessMutation: () => [
    (args: unknown) => {
      addAccess(args);
      return { unwrap: async () => ({ added: 2, skipped: 0 }) };
    },
    { isLoading: false },
  ],
  useRemoveBotPageAccessMutation: () => [vi.fn()],
}));
vi.mock("../unsavedChanges", () => ({ useReportUnsaved: () => undefined }));

const { BotPageTab } = await import("../BotPageTab");
const bot = { id: "bot-1", name: "Sunrise Mind" } as never;

const preview = () => screen.getByTestId("bot-page-preview");

describe("BotPageTab", () => {
  beforeEach(() => {
    save.mockClear();
    addAccess.mockClear();
    pageResult = { data: view(), isLoading: false, isError: false, refetch: () => undefined };
  });

  it("shows the link with its QR code, and the page as visitors see it", async () => {
    render(<BotPageTab bot={bot} canEdit />);
    expect(screen.getByText("http://localhost:8081/b/sunrise-mind")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByAltText(/QR code for http:\/\/localhost:8081\/b\/sunrise-mind/),
      ).toHaveAttribute("src", "data:image/png;qr,http://localhost:8081/b/sunrise-mind"),
    );
    expect(within(preview()).getByText("Sunrise Mind")).toBeInTheDocument();
    expect(within(preview()).getByText("Not a crisis service.")).toBeInTheDocument();
  });

  it("updates the preview, link and QR as the owner types", async () => {
    render(<BotPageTab bot={bot} canEdit />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Mehta Clinic" } });
    expect(within(preview()).getByText("Mehta Clinic")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Link name"), { target: { value: "Mehta-Clinic" } });
    expect(screen.getByText("http://localhost:8081/b/mehta-clinic")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByAltText(/QR code/)).toHaveAttribute(
        "src",
        "data:image/png;qr,http://localhost:8081/b/mehta-clinic",
      ),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    expect(within(preview()).getByText("What are your fees?")).toBeInTheDocument();
  });

  it("offers public links only once the platform allows them", () => {
    render(<BotPageTab bot={bot} canEdit />);
    expect(screen.getByLabelText(/turned off until the crisis safety review/)).toBeDisabled();
  });

  it("saves the whole page, trimmed", () => {
    render(<BotPageTab bot={bot} canEdit />);
    fireEvent.change(screen.getByLabelText("Subtitle"), { target: { value: "Ask us anything" } });
    fireEvent.click(screen.getByRole("button", { name: "Save bot page" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "bot-1",
        status: "on",
        slug: "sunrise-mind",
        access: "invite",
        settings: expect.objectContaining({
          branding: expect.objectContaining({ subtitle: "Ask us anything" }),
          suggestedQuestions: ["What are your fees?"],
        }),
      }),
    );
  });

  it("reorders, adds and deletes pre-chat questions, up to eight", () => {
    render(<BotPageTab bot={bot} canEdit />);
    fireEvent.click(screen.getAllByRole("button", { name: "Move down" })[0]);
    expect((screen.getByRole("textbox", { name: "Question 1" }) as HTMLInputElement).value).toBe(
      "Reason",
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    expect(screen.queryByDisplayValue("Reason")).toBeNull();
    for (let i = 0; i < 7; i++)
      fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    expect(screen.queryByRole("button", { name: "Add question" })).toBeNull();
  });

  it("allows at most four suggested questions", () => {
    render(<BotPageTab bot={bot} canEdit />);
    for (let i = 0; i < 3; i++)
      fireEvent.click(screen.getByRole("button", { name: "Add suggestion" }));
    expect(screen.queryByRole("button", { name: "Add suggestion" })).toBeNull();
  });

  it("adds pasted invite emails to the page's own list", () => {
    render(<BotPageTab bot={bot} canEdit />);
    expect(screen.getByText("asha@example.com")).toBeInTheDocument();
    expect(
      screen.getByText(/never changes who can chat with the bot on WhatsApp/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Paste emails, one per line"), {
      target: { value: "ravi@example.com\nmeera@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add emails" }));
    expect(addAccess).toHaveBeenCalledWith({
      id: "bot-1",
      entries: [
        { kind: "email", value: "ravi@example.com" },
        { kind: "email", value: "meera@example.com" },
      ],
    });
  });

  it("is read-only for viewers", () => {
    render(<BotPageTab bot={bot} canEdit={false} />);
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save bot page" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add question" })).toBeNull();
  });

  it("says why the link is not answering", () => {
    pageResult = {
      ...pageResult,
      data: view({ live: { ok: false, reason: "bot_not_live" }, dailyCapReached: true }),
    };
    render(<BotPageTab bot={bot} canEdit />);
    expect(screen.getByText(/The bot isn't published yet/)).toBeInTheDocument();
    expect(screen.getByText(/Today's message cap is reached/)).toBeInTheDocument();
  });
});
