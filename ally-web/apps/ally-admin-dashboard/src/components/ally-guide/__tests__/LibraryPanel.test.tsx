import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const h = vi.hoisted(() => ({
  library: vi.fn(),
  createUrl: vi.fn(),
  create: vi.fn(),
  archive: vi.fn(),
  put: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@ally-ui-mono/ui-shared", async () => (await import("./uiSharedFakes")).uiSharedFakes);
vi.mock("sonner", () => ({
  toast: { error: (m: string) => h.toastError(m), success: (m: string) => h.toastSuccess(m) },
}));
vi.mock("axios", () => ({ default: { put: (...args: unknown[]) => h.put(...args) } }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAllyGuideLibraryQuery: (args: unknown, options: unknown) => h.library(args, options),
  useCreateAllyGuideLibraryUploadUrlMutation: () => [h.createUrl],
  useCreateAllyGuideLibraryDocumentMutation: () => [h.create],
  useArchiveAllyGuideLibraryDocumentMutation: () => [h.archive, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { LibraryPanel } from "../LibraryPanel";

const doc = (overrides: Record<string, unknown> = {}) => ({
  id: "d-1",
  title: "Safeguarding protocol",
  sourceType: "pdf",
  sourceUrl: null,
  fileName: "safeguarding.pdf",
  sizeBytes: 1000,
  language: "en",
  tags: [],
  status: "indexed",
  statusMessage: null,
  chunkCount: 12,
  indexedChunkCount: 12,
  isArchived: false,
  createdAt: "2026-10-20T09:00:00.000Z",
  updatedAt: "2026-10-20T09:00:00.000Z",
  ...overrides,
});

const loaded = (documents: unknown[]) => ({
  data: { documents, count: documents.length },
  isLoading: false,
  isError: false,
  error: undefined,
  refetch: vi.fn(),
});

const renderPanel = (props: Record<string, unknown> = {}) =>
  render(<LibraryPanel scope="platform" canEdit {...(props as object)} />);

const file = (name: string, type: string, size = 1000) =>
  new File([new Uint8Array(1)], name, { type }) as File & { size: number };

describe("LibraryPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.library.mockReturnValue(loaded([doc()]));
    h.createUrl.mockReturnValue({
      unwrap: () => Promise.resolve({ presignedUrl: "https://s3/put", fileUrl: "https://s3/file" }),
    });
    h.create.mockReturnValue({ unwrap: () => Promise.resolve({ id: "d-2" }) });
    h.archive.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    h.put.mockResolvedValue({});
  });

  describe("the list", () => {
    it("asks for the platform library, or one organisation's by its id", () => {
      renderPanel();
      expect(h.library.mock.calls[0][0]).toEqual({ scope: "platform", tenantId: undefined });

      renderPanel({ scope: "organisation", tenantId: "t-1" });
      expect(h.library.mock.calls.at(-1)?.[0]).toEqual({ scope: "organisation", tenantId: "t-1" });
    });

    it("shows each document with its source, its status in words and how much is indexed", () => {
      renderPanel();

      const row = screen.getByTestId("library-row");
      expect(row).toHaveTextContent("Safeguarding protocol");
      expect(row).toHaveTextContent("safeguarding.pdf");
      expect(row).toHaveTextContent("PDF");
      expect(row).toHaveTextContent("Ready");
      expect(row).toHaveTextContent("12 of 12 passages");
    });

    it("gives the reason, verbatim, for a document that failed to index", () => {
      h.library.mockReturnValue(
        loaded([doc({ status: "failed", statusMessage: "The PDF is encrypted" })]),
      );
      renderPanel();

      expect(screen.getByTestId("library-row")).toHaveTextContent("Failed");
      expect(screen.getByTestId("library-failed-why")).toHaveTextContent("The PDF is encrypted");
    });

    it("leaves out an archived document", () => {
      h.library.mockReturnValue(loaded([doc({ id: "a", isArchived: true })]));
      renderPanel();

      expect(screen.queryByTestId("library-row")).not.toBeInTheDocument();
      expect(screen.getByText("No documents yet")).toBeInTheDocument();
    });

    it("refreshes by itself while a document is still being read, and stops when all are ready", () => {
      h.library.mockReturnValue(loaded([doc({ status: "indexing" })]));
      const { rerender } = render(<LibraryPanel scope="platform" canEdit />);

      expect(h.library.mock.calls.at(-1)?.[1]).toMatchObject({ pollingInterval: 5000 });

      h.library.mockReturnValue(loaded([doc({ status: "indexed" })]));
      rerender(<LibraryPanel scope="platform" canEdit />);
      rerender(<LibraryPanel scope="platform" canEdit />);

      expect(h.library.mock.calls.at(-1)?.[1]).toMatchObject({ pollingInterval: 0 });
    });

    it("shows a skeleton while loading, and a failure with a retry, apart from an empty list", () => {
      h.library.mockReturnValue({ data: undefined, isLoading: true, isError: false });
      const { unmount } = renderPanel();
      expect(screen.getByTestId("ally-loading")).toBeInTheDocument();
      unmount();

      const refetch = vi.fn();
      h.library.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: { status: 500 },
        refetch,
      });
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(refetch).toHaveBeenCalled();
    });

    it("asks for an organisation when the organisation library has none chosen", () => {
      renderPanel({ scope: "organisation", tenantId: undefined });

      expect(screen.getByText("Choose an organisation to see its library.")).toBeInTheDocument();
    });
  });

  describe("adding a document", () => {
    const openDialog = () => {
      fireEvent.click(screen.getByRole("button", { name: "Add a document…" }));
      return screen.getByRole("dialog", { name: "Add a document" });
    };

    it("pastes text, naming the scope in the call and not in the document", async () => {
      renderPanel({ scope: "organisation", tenantId: "t-1" });
      const dialog = openDialog();

      fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Protocol" } });
      fireEvent.change(within(dialog).getByLabelText("Text"), {
        target: { value: "Call the lead." },
      });
      fireEvent.click(within(dialog).getByRole("button", { name: "Add document" }));

      await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
      expect(h.create).toHaveBeenCalledWith({
        scope: "organisation",
        tenantId: "t-1",
        title: "Protocol",
        sourceType: "paste",
        text: "Call the lead.",
      });
      expect(h.toastSuccess).toHaveBeenCalledWith("Added. Ally can use it once it shows Ready.");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("cannot be confirmed without a title and some text", () => {
      renderPanel();
      const dialog = openDialog();
      expect(within(dialog).getByRole("button", { name: "Add document" })).toBeDisabled();

      fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Protocol" } });
      expect(within(dialog).getByRole("button", { name: "Add document" })).toBeDisabled();

      fireEvent.change(within(dialog).getByLabelText("Text"), { target: { value: "Body" } });
      expect(within(dialog).getByRole("button", { name: "Add document" })).toBeEnabled();
    });

    it("uploads a file straight to storage, then adds the document with the URL it was given", async () => {
      renderPanel();
      const dialog = openDialog();

      fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Handbook" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "PDF" }));
      fireEvent.change(within(dialog).getByLabelText("File"), {
        target: { files: [file("handbook.pdf", "application/pdf")] },
      });
      expect(within(dialog).getByText("Chosen: handbook.pdf")).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: "Add document" }));

      await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
      expect(h.createUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: "platform",
          fileName: "handbook.pdf",
          contentType: "application/pdf",
        }),
      );
      expect(h.put).toHaveBeenCalledWith(
        "https://s3/put",
        expect.anything(),
        expect.objectContaining({ headers: { "Content-Type": "application/pdf" } }),
      );
      expect(h.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceType: "pdf",
          fileUrl: "https://s3/file",
          fileName: "handbook.pdf",
          contentType: "application/pdf",
        }),
      );
    });

    it("accepts an EPUB the browser reports as a generic type, by its extension", async () => {
      renderPanel();
      const dialog = openDialog();
      fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Book" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "EPUB" }));

      fireEvent.change(within(dialog).getByLabelText("File"), {
        target: { files: [file("book.epub", "application/octet-stream")] },
      });

      expect(within(dialog).getByText("Chosen: book.epub")).toBeInTheDocument();
      expect(h.toastError).not.toHaveBeenCalled();
    });

    it("refuses a file of the wrong kind for the chosen source", () => {
      renderPanel();
      const dialog = openDialog();
      fireEvent.click(within(dialog).getByRole("button", { name: "PDF" }));

      fireEvent.change(within(dialog).getByLabelText("File"), {
        target: { files: [file("notes.txt", "text/plain")] },
      });

      expect(h.toastError).toHaveBeenCalledWith(
        "That is not the right kind of file for this source.",
      );
      expect(within(dialog).queryByText(/Chosen:/)).not.toBeInTheDocument();
    });

    it("adds nothing when the upload itself fails", async () => {
      h.put.mockRejectedValue(new Error("network"));
      renderPanel();
      const dialog = openDialog();
      fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Handbook" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "PDF" }));
      fireEvent.change(within(dialog).getByLabelText("File"), {
        target: { files: [file("handbook.pdf", "application/pdf")] },
      });

      fireEvent.click(within(dialog).getByRole("button", { name: "Add document" }));

      await waitFor(() =>
        expect(h.toastError).toHaveBeenCalledWith("The file did not upload. Nothing was added."),
      );
      expect(h.create).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("shows the server's message and keeps the dialog when adding is refused", async () => {
      h.create.mockReturnValue({
        unwrap: () => Promise.reject({ status: 400, data: { message: "That text is too long" } }),
      });
      renderPanel();
      const dialog = openDialog();
      fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "x" } });
      fireEvent.change(within(dialog).getByLabelText("Text"), { target: { value: "y" } });

      fireEvent.click(within(dialog).getByRole("button", { name: "Add document" }));

      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("That text is too long"));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("removing a document", () => {
    it("asks first, saying what removing does and does not do", async () => {
      renderPanel({ scope: "organisation", tenantId: "t-1" });

      fireEvent.click(screen.getByRole("button", { name: "Remove" }));
      const dialog = screen.getByRole("dialog", { name: "Remove Safeguarding protocol?" });
      expect(dialog).toHaveTextContent("Ally stops using this document at once");
      expect(dialog).toHaveTextContent("citations already given still resolve");
      expect(h.archive).not.toHaveBeenCalled();

      fireEvent.click(within(dialog).getByRole("button", { name: "Remove document" }));

      await waitFor(() =>
        expect(h.archive).toHaveBeenCalledWith({
          scope: "organisation",
          tenantId: "t-1",
          id: "d-1",
        }),
      );
      expect(h.toastSuccess).toHaveBeenCalledWith("Removed.");
    });

    it("keeps the dialog and shows the server's message when it cannot be removed", async () => {
      h.archive.mockReturnValue({
        unwrap: () =>
          Promise.reject({
            status: 404,
            data: { message: "Not one of this organisation's documents" },
          }),
      });
      renderPanel();

      fireEvent.click(screen.getByRole("button", { name: "Remove" }));
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Remove document" }),
      );

      await waitFor(() =>
        expect(h.toastError).toHaveBeenCalledWith("Not one of this organisation's documents"),
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("access", () => {
    it("shows the documents but offers no add or remove to an admin who can only view", () => {
      renderPanel({ canEdit: false });

      expect(screen.getByTestId("library-row")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add a document…" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    });

    it("says in its intro which audience reads the library", () => {
      renderPanel();
      expect(screen.getByTestId("library-platform")).toHaveTextContent("every learner and visitor");

      renderPanel({ scope: "organisation", tenantId: "t-1" });
      expect(screen.getByTestId("library-organisation")).toHaveTextContent(
        "Only this organisation's learners' Ally reads them",
      );
    });
  });
});
