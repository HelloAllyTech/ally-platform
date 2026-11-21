import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReportBugModal } from "../ReportBugModal";

const mockCreateBugReport = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock("@api", () => ({
  useCreateRoadmapBugReportMutation: () => [mockCreateBugReport],
}));

vi.mock("sonner", () => ({
  toast: {
    success: (message: string) => mockToastSuccess(message),
    error: vi.fn(),
  },
}));

const REPORT = "Vote button saved 0 votes silently after I clicked it twice";

const renderModal = (onClose = vi.fn()) =>
  render(
    <MemoryRouter initialEntries={["/roadmap/i/OPP-0614?tab=plan"]}>
      <ReportBugModal onClose={onClose} />
    </MemoryRouter>,
  );

const describeIt = (text = REPORT) =>
  fireEvent.change(screen.getByLabelText(/what were you trying to do/i), {
    target: { value: text },
  });

describe("ReportBugModal — the consumer's one-box form, opened from admin", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("asks one thing only — no expectation, place, steps, timing, severity or codebase", () => {
    renderModal();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /add details/i })).toBeNull();
    expect(screen.getByTestId("bug-report-form-full-screen")).toBeInTheDocument();
  });

  it("sends as soon as anything is typed, with silently captured context, then toasts and closes", async () => {
    mockCreateBugReport.mockReturnValue({
      unwrap: () => Promise.resolve({ id: "finding-1", stage: "new" }),
    });
    const onClose = vi.fn();
    renderModal(onClose);

    const send = screen.getByRole("button", { name: /send report/i });
    expect(send).toBeDisabled();
    describeIt("broken");
    expect(send).toBeEnabled();
    describeIt();
    fireEvent.click(send);

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);

    const [body] = mockCreateBugReport.mock.calls[0];
    expect(body.description).toBe(REPORT);
    expect(body).not.toHaveProperty("repo");
    // The query string is part of the captured screen: on the roadmap the open tab lives there.
    expect(body.context.screen).toBe("/roadmap/i/OPP-0614?tab=plan");
    expect(typeof body.context.clientTimestamp).toBe("string");
    expect(Object.keys(body.context).sort()).toEqual(
      expect.arrayContaining(["clientTimestamp", "screen"]),
    );
    expect(body.context).not.toHaveProperty("expected");
    expect(body.context).not.toHaveProperty("surface");
  });

  it("shows the throttle message rather than the generic one on a 429", async () => {
    mockCreateBugReport.mockReturnValue({
      unwrap: () => Promise.reject({ status: 429, data: { statusCode: 429 } }),
    });
    renderModal();
    describeIt();
    fireEvent.click(screen.getByRole("button", { name: /send report/i }));

    expect(await screen.findByText(/submitted a few reports recently/i)).toBeInTheDocument();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("keeps the form open on any other failure so the typed report is not lost", async () => {
    mockCreateBugReport.mockReturnValue({ unwrap: () => Promise.reject({ status: 500 }) });
    const onClose = vi.fn();
    renderModal(onClose);
    describeIt();
    fireEvent.click(screen.getByRole("button", { name: /send report/i }));

    expect(await screen.findByText(/something went wrong sending that/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/what were you trying to do/i)).toHaveValue(REPORT);
  });
});
