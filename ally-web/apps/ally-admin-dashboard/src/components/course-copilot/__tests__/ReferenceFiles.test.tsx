import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";

const { uploadFn, removeFn, toastError } = vi.hoisted(() => ({
  uploadFn: vi.fn(),
  removeFn: vi.fn(),
  toastError: vi.fn(),
}));
let sourcesData: any[] = [];

vi.mock("@api", () => ({
  useGetCourseCopilotSourcesQuery: () => ({ data: sourcesData }),
  useUploadCourseCopilotSourceMutation: () => [uploadFn],
  useRemoveCourseCopilotSourceMutation: () => [removeFn],
}));
vi.mock("@components", () => ({ cellTypes: {} }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("@ally-ui-mono/ui-shared", () => ({
  InlineLoading: ({ description }: any) => <span>{description}</span>,
}));

// eslint-disable-next-line import/first
import { ReferenceFiles } from "../ReferenceFiles";

const strings = en.courseCopilot.sources;
const ok = (value: any = {}) => ({ unwrap: () => Promise.resolve(value) });
const refused = (message: string) => ({
  unwrap: () => Promise.reject({ status: 400, data: { message } }),
});
const pdf = (name: string) => new File(["x"], name, { type: "application/pdf" });

const choose = async (...files: File[]) => {
  await act(async () => {
    fireEvent.change(screen.getByTestId("course-copilot-source-input"), {
      target: { files },
    });
  });
};

beforeEach(() => {
  sourcesData = [];
  uploadFn.mockReset().mockImplementation(() => ok());
  removeFn.mockReset().mockImplementation(() => ok());
  toastError.mockReset();
});

describe("ReferenceFiles", () => {
  it("uploads each chosen file in its own request", async () => {
    render(<ReferenceFiles sessionId="s-1" variant="opening" />);
    const a = pdf("a.pdf");
    const b = pdf("b.pdf");

    await choose(a, b);

    expect(uploadFn).toHaveBeenCalledTimes(2);
    expect(uploadFn).toHaveBeenNthCalledWith(1, { id: "s-1", file: a });
    expect(uploadFn).toHaveBeenNthCalledWith(2, { id: "s-1", file: b });
  });

  it("shows the server's reason for a refused file, and still attaches the rest", async () => {
    uploadFn
      .mockImplementationOnce(() => refused('No text was found in "scan.pdf".'))
      .mockImplementationOnce(() => ok());
    render(<ReferenceFiles sessionId="s-1" variant="opening" />);

    await choose(pdf("scan.pdf"), pdf("manual.pdf"));

    expect(screen.getByRole("alert")).toHaveTextContent('No text was found in "scan.pdf".');
    expect(uploadFn).toHaveBeenCalledTimes(2);
  });

  it("lists attached files with what was read from them, and removes one", async () => {
    sourcesData = [
      { id: "f-1", fileName: "Manual.pdf", kind: "pdf", pageCount: 42, passageCount: 90 },
      { id: "f-2", fileName: "Deck.pptx", kind: "pptx", pageCount: 1, passageCount: 3 },
      { id: "f-3", fileName: "Notes.docx", kind: "docx", pageCount: null, passageCount: 7 },
    ];
    render(<ReferenceFiles sessionId="s-1" />);

    expect(screen.getByText("42 pages")).toBeInTheDocument();
    expect(screen.getByText("1 slide")).toBeInTheDocument();
    expect(screen.getByText("7 passages")).toBeInTheDocument();
    expect(screen.getByText(strings.privacy)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.remove("Manual.pdf") }));
    });
    expect(removeFn).toHaveBeenCalledWith({ id: "s-1", sourceId: "f-1" });
  });

  it("says why when a removal fails", async () => {
    sourcesData = [
      { id: "f-1", fileName: "Manual.pdf", kind: "pdf", pageCount: 2, passageCount: 4 },
    ];
    removeFn.mockImplementation(() => refused("Wait for the build to finish."));
    render(<ReferenceFiles sessionId="s-1" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: strings.remove("Manual.pdf") }));
    });
    expect(toastError).toHaveBeenCalledWith("Wait for the build to finish.");
  });

  it("while locked, lists files read-only and says why", () => {
    sourcesData = [
      { id: "f-1", fileName: "Manual.pdf", kind: "pdf", pageCount: 2, passageCount: 4 },
    ];
    render(<ReferenceFiles sessionId="s-1" lockedReason={strings.lockedBuilding} />);

    expect(screen.queryByTestId("course-copilot-source-input")).toBeNull();
    expect(screen.queryByRole("button", { name: strings.remove("Manual.pdf") })).toBeNull();
    expect(screen.getByText(strings.lockedBuilding)).toBeInTheDocument();
  });

  it("draws nothing in the pane when locked with no files", () => {
    const { container } = render(
      <ReferenceFiles sessionId="s-1" lockedReason={strings.lockedArchived} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
