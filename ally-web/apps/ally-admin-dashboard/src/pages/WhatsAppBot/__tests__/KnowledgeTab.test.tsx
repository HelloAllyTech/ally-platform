import React from "react";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Chatbot, ChatbotDocumentDetail, ChatbotDocumentRow } from "@types";

/**
 * The Knowledge tab: a chatbot's own documents (uploaded here, private to it, with their indexing
 * status) beside the ones picked from the shared library. Uploading presigns, PUTs the file, then
 * creates the private document; removing a private document deletes it after a confirm.
 */

let docs: ChatbotDocumentRow[] = [];
const queryOptions = vi.fn();
const setDocumentsSpy = vi.fn((_args: unknown) => ({ unwrap: async () => [] }));
const removeSpy = vi.fn((_args: unknown) => ({ unwrap: async () => [] }));
const uploadUrlSpy = vi.fn((_args: unknown) => ({
  unwrap: async () => ({ presignedUrl: "https://s3.test/put", fileUrl: "s3://bucket/faq.pdf" }),
}));
const createPrivateSpy = vi.fn((_args: unknown) => ({ unwrap: async () => [] }));
const axiosPut = vi.fn(async () => ({}));
let detail: ChatbotDocumentDetail | undefined;
const detailArgs = vi.fn();
const updateDocSpy = vi.fn((_args: unknown) => ({ unwrap: async () => detail }));

// The real copy and upload limits, without the whole constants barrel.
vi.mock("@constants", async () => ({
  en: (await import("../../../constants/en")).en,
  ...(await import("../../../constants/file")),
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
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
  EntityField: ({ label, children }: { label: string; children: React.ReactNode }) => (
    <fieldset>
      <legend>{label}</legend>
      {children}
    </fieldset>
  ),
  EntitySidePanel: ({
    isOpen,
    title,
    saveDisabled,
    hideSave,
    onSave,
    children,
  }: {
    isOpen: boolean;
    title: string;
    saveDisabled?: boolean;
    hideSave?: boolean;
    onSave?: () => void;
    children: React.ReactNode;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
        {!hideSave && (
          <button type="button" onClick={onSave} disabled={saveDisabled}>
            Save panel
          </button>
        )}
      </div>
    ) : null,
}));
vi.mock("@components/types", () => ({
  ButtonVariant: { PRIMARY: "primary", SECONDARY: "secondary" },
}));
vi.mock("@utils", () => ({ formatRelativeTime: () => "just now" }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("axios", () => ({ default: { put: axiosPut } }));

vi.mock("@api", () => ({
  useGetChatbotDocumentsQuery: (_id: string, options: unknown) => {
    queryOptions(options);
    return { data: docs, isLoading: false, isError: false, refetch: vi.fn() };
  },
  useGetKbDocumentsQuery: () => ({ data: { documents: [], count: 0 }, isFetching: false }),
  useSetChatbotDocumentsMutation: () => [setDocumentsSpy, { isLoading: false }],
  useRemoveChatbotDocumentMutation: () => [removeSpy, { isLoading: false }],
  useUpdateChatbotMutation: () => [vi.fn(), { isLoading: false }],
  useCreateChatbotDocumentUploadUrlMutation: () => [uploadUrlSpy],
  useCreatePrivateChatbotDocumentMutation: () => [createPrivateSpy, { isLoading: false }],
  useGetChatbotDocumentQuery: (args: unknown, options: { skip?: boolean }) => {
    detailArgs(args, options);
    return options.skip
      ? { data: undefined, isFetching: false, isError: false, refetch: vi.fn() }
      : { data: detail, isFetching: false, isError: false, refetch: vi.fn() };
  },
  useUpdateChatbotDocumentMutation: () => [updateDocSpy, { isLoading: false }],
}));

const { KnowledgeTab } = await import("../KnowledgeTab");

const BOT = { id: "bot-1", name: "Sunrise", knowledgeSource: "selected" } as unknown as Chatbot;

const row = (over: Partial<ChatbotDocumentRow>): ChatbotDocumentRow => ({
  id: "doc",
  title: "Doc",
  status: "indexed",
  isGlobal: false,
  archived: false,
  private: false,
  updatedAt: "2026-11-06T10:00:00Z",
  ...over,
});

const lastPolling = () =>
  (queryOptions.mock.calls.at(-1)?.[0] as { pollingInterval: number }).pollingInterval;

describe("KnowledgeTab — the chatbot's documents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    docs = [
      row({ id: "own", title: "Clinic FAQ", private: true, status: "indexing" }),
      row({ id: "lib", title: "Sleep guide", isGlobal: true }),
      row({ id: "bad", title: "Broken scan", private: true, status: "failed" }),
    ];
  });
  afterEach(() => vi.restoreAllMocks());

  it("tags private documents and shows their status", () => {
    render(<KnowledgeTab bot={BOT} canEdit />);
    const own = screen.getByText("Clinic FAQ").closest("li")!;
    expect(within(own).getByText("Private to this chatbot")).toBeInTheDocument();
    expect(within(own).getByText("Training…")).toBeInTheDocument();
    const lib = screen.getByText("Sleep guide").closest("li")!;
    expect(within(lib).queryByText("Private to this chatbot")).not.toBeInTheDocument();
    expect(within(lib).queryByText("Training…")).not.toBeInTheDocument();
    expect(
      within(screen.getByText("Broken scan").closest("li")!).getByText("Failed"),
    ).toBeInTheDocument();
  });

  it("polls while a document is indexing, and stops once none is", () => {
    const { rerender } = render(<KnowledgeTab bot={BOT} canEdit />);
    expect(lastPolling()).toBe(4000);
    docs = docs.map(d => ({ ...d, status: d.status === "indexing" ? "indexed" : d.status }));
    rerender(<KnowledgeTab bot={BOT} canEdit />);
    expect(lastPolling()).toBe(0);
  });

  it("deletes a private document after a confirm that says so", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<KnowledgeTab bot={BOT} canEdit />);
    const own = screen.getByText("Clinic FAQ").closest("li")!;
    fireEvent.click(within(own).getByRole("button", { name: "Remove" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Delete “Clinic FAQ”?"));
    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith({ id: "bot-1", documentId: "own" }));
    expect(setDocumentsSpy).not.toHaveBeenCalled();
  });

  it("keeps a private document when the confirm is cancelled", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<KnowledgeTab bot={BOT} canEdit />);
    const own = screen.getByText("Clinic FAQ").closest("li")!;
    fireEvent.click(within(own).getByRole("button", { name: "Remove" }));
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("takes a library document off by saving the other library documents", async () => {
    docs = [...docs, row({ id: "lib2", title: "Stress guide", isGlobal: true })];
    render(<KnowledgeTab bot={BOT} canEdit />);
    const lib = screen.getByText("Sleep guide").closest("li")!;
    fireEvent.click(within(lib).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(setDocumentsSpy).toHaveBeenCalledWith({ id: "bot-1", documentIds: ["lib2"] }),
    );
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("shows viewers no upload or remove", () => {
    render(<KnowledgeTab bot={BOT} canEdit={false} />);
    expect(screen.queryByRole("button", { name: "Upload a document" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });
});

describe("KnowledgeTab — upload a document", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    docs = [];
  });

  it("presigns, uploads the file, then creates it private to the chatbot", async () => {
    render(<KnowledgeTab bot={BOT} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Upload a document" }));
    const panel = screen.getByRole("dialog", { name: "Upload a document" });
    expect(within(panel).getByRole("button", { name: "Save panel" })).toBeDisabled();

    const file = new File(["%PDF"], "Sunrise FAQ.pdf", { type: "application/pdf" });
    fireEvent.change(within(panel).getByTestId("knowledge-upload-input"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(within(panel).getByRole("textbox")).toHaveValue("Sunrise FAQ"));
    expect(uploadUrlSpy).toHaveBeenCalledWith({
      id: "bot-1",
      fileName: "Sunrise FAQ.pdf",
      fileSize: file.size,
      contentType: "application/pdf",
    });
    expect(axiosPut).toHaveBeenCalledWith("https://s3.test/put", file, {
      headers: { "Content-Type": "application/pdf" },
    });

    fireEvent.click(within(panel).getByRole("button", { name: "Save panel" }));
    await waitFor(() =>
      expect(createPrivateSpy).toHaveBeenCalledWith({
        id: "bot-1",
        title: "Sunrise FAQ",
        sourceType: "pdf",
        fileUrl: "s3://bucket/faq.pdf",
        fileName: "Sunrise FAQ.pdf",
        contentType: "application/pdf",
        sizeBytes: file.size,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Upload a document" })).not.toBeInTheDocument(),
    );
  });

  it("refuses a file that is not a PDF, Word or EPUB file", async () => {
    const { toast } = await import("sonner");
    render(<KnowledgeTab bot={BOT} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Upload a document" }));
    fireEvent.change(screen.getByTestId("knowledge-upload-input"), {
      target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] },
    });
    expect(toast.error).toHaveBeenCalledWith("Choose a PDF, Word (.docx) or EPUB file.");
    expect(uploadUrlSpy).not.toHaveBeenCalled();
  });
});

describe("KnowledgeTab — training status and the document panel", () => {
  const detailOf = (over: Partial<ChatbotDocumentDetail>): ChatbotDocumentDetail => ({
    id: "own",
    title: "Clinic FAQ",
    status: "indexed",
    private: true,
    archived: false,
    sourceType: "paste",
    fileName: null,
    statusMessage: null,
    updatedAt: "2026-11-06T10:00:00Z",
    rawText: "Opening hours\nMonday to Friday",
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    docs = [
      row({ id: "own", title: "Clinic FAQ", private: true, status: "indexed" }),
      row({ id: "new", title: "New leaflet", private: true, status: "pending" }),
      row({ id: "bad", title: "Broken scan", private: true, status: "failed" }),
      row({ id: "lib", title: "Sleep guide", isGlobal: true, status: "indexed" }),
      row({ id: "old", title: "Old guide", archived: true, status: "indexed" }),
    ];
    detail = detailOf({});
  });

  const rowOf = (title: string) => screen.getByText(title).closest("li")!;

  it("tags every row Trained, Training… or Failed, and archived rows only Archived", () => {
    render(<KnowledgeTab bot={BOT} canEdit />);
    expect(within(rowOf("Clinic FAQ")).getByText("Trained")).toBeInTheDocument();
    expect(within(rowOf("Sleep guide")).getByText("Trained")).toBeInTheDocument();
    expect(within(rowOf("New leaflet")).getByText("Training…")).toBeInTheDocument();
    expect(within(rowOf("Broken scan")).getByText("Failed")).toBeInTheDocument();
    const old = rowOf("Old guide");
    expect(within(old).getByText("Archived")).toBeInTheDocument();
    expect(within(old).queryByText("Trained")).not.toBeInTheDocument();
    expect(screen.queryByText("Indexing…")).not.toBeInTheDocument();
  });

  it("loads nothing until View is pressed, then shows the document's text", () => {
    render(<KnowledgeTab bot={BOT} canEdit={false} />);
    expect(detailArgs).toHaveBeenLastCalledWith(expect.anything(), { skip: true });
    fireEvent.click(within(rowOf("Clinic FAQ")).getByRole("button", { name: "View" }));
    expect(detailArgs).toHaveBeenLastCalledWith(
      { id: "bot-1", documentId: "own" },
      { skip: false },
    );
    const panel = screen.getByRole("dialog");
    expect(within(panel).getByTestId("knowledge-document-text")).toHaveTextContent(
      "Opening hours Monday to Friday",
    );
    expect(within(panel).getByText("Trained")).toBeInTheDocument();
    expect(within(panel).getByText("Private to this chatbot")).toBeInTheDocument();
  });

  it("shows why a document failed", () => {
    detail = detailOf({ id: "bad", status: "failed", statusMessage: "No text found in the file." });
    render(<KnowledgeTab bot={BOT} canEdit />);
    fireEvent.click(within(rowOf("Broken scan")).getByRole("button", { name: "View" }));
    expect(screen.getByText("No text found in the file.")).toBeInTheDocument();
  });

  it("lets an editor change a private document and sends only what changed", async () => {
    render(<KnowledgeTab bot={BOT} canEdit />);
    fireEvent.click(within(rowOf("Clinic FAQ")).getByRole("button", { name: "View" }));
    const panel = screen.getByRole("dialog");
    expect(
      within(panel).getByText("Saving changes retrains the chatbot on this document."),
    ).toBeInTheDocument();
    const save = within(panel).getByRole("button", { name: "Save panel" });
    expect(save).toBeDisabled();

    const [title, text] = within(panel).getAllByRole("textbox");
    expect(title).toHaveValue("Clinic FAQ");
    fireEvent.change(text, { target: { value: "Opening hours\nMonday to Saturday" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() =>
      expect(updateDocSpy).toHaveBeenCalledWith({
        id: "bot-1",
        documentId: "own",
        text: "Opening hours\nMonday to Saturday",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows a library document read-only, pointing to the Knowledge library", () => {
    detail = detailOf({ id: "lib", title: "Sleep guide", private: false });
    render(<KnowledgeTab bot={BOT} canEdit />);
    fireEvent.click(within(rowOf("Sleep guide")).getByRole("button", { name: "View" }));
    const panel = screen.getByRole("dialog");
    expect(within(panel).getByText("From the library")).toBeInTheDocument();
    expect(
      within(panel).getByText("Library documents are edited in the Knowledge library."),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Save panel" })).not.toBeInTheDocument();
  });

  it("does not let a viewer edit a private document", () => {
    render(<KnowledgeTab bot={BOT} canEdit={false} />);
    fireEvent.click(within(rowOf("Clinic FAQ")).getByRole("button", { name: "View" }));
    const panel = screen.getByRole("dialog");
    expect(within(panel).getByTestId("knowledge-document-text")).toBeInTheDocument();
    expect(within(panel).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Save panel" })).not.toBeInTheDocument();
    expect(
      within(panel).queryByText("Library documents are edited in the Knowledge library."),
    ).not.toBeInTheDocument();
  });
});
