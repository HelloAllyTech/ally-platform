import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

const { mockToast, mockUseGetDigestRecipientsQuery, mockAdd, mockRemove } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  mockUseGetDigestRecipientsQuery: vi.fn(),
  mockAdd: vi.fn(),
  mockRemove: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: mockToast }));

vi.mock("@api", async importOriginal => {
  const actual = await importOriginal<typeof import("@api")>();
  return {
    ...actual,
    useGetDigestRecipientsQuery: (...args: any[]) => mockUseGetDigestRecipientsQuery(...args),
    useAddDigestRecipientMutation: () => [mockAdd, { isLoading: false }],
    useRemoveDigestRecipientMutation: () => [mockRemove],
  };
});

// Same import order the app uses, so the api -> utils -> store cycle resolves.
import "@constants";

import { DigestRecipients } from "../DigestRecipients";

const recipients = [
  { id: "r-1", email: "asha@example.com", addedAt: "2026-11-20T10:00:00Z" },
  { id: "r-2", email: "bea@example.com", addedAt: "2026-11-20T10:00:00Z" },
];

describe("DigestRecipients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseGetDigestRecipientsQuery.mockReturnValue({ data: { recipients }, isLoading: false });
    mockAdd.mockResolvedValue({ data: { recipients } });
    mockRemove.mockResolvedValue({ data: { recipients: [] } });
  });

  it("lists everyone on the daily email", () => {
    render(<DigestRecipients />);

    expect(screen.getByText("asha@example.com")).toBeInTheDocument();
    expect(screen.getByText("bea@example.com")).toBeInTheDocument();
  });

  it("says plainly that nothing is sent when the list is empty", () => {
    mockUseGetDigestRecipientsQuery.mockReturnValue({ data: { recipients: [] }, isLoading: false });
    render(<DigestRecipients />);

    expect(screen.getByText(/daily email is not being sent/i)).toBeInTheDocument();
  });

  it("adds an address and clears the field", async () => {
    render(<DigestRecipients />);
    const input = screen.getByLabelText("Email address");

    fireEvent.change(input, { target: { value: "  New@Example.com " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith({ email: "New@Example.com" }));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(mockToast.success).toHaveBeenCalledWith("new@example.com will get the daily email.");
  });

  it("rejects an obvious typo without calling the server", () => {
    render(<DigestRecipients />);

    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address.");
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("shows the server's reason when the address is a duplicate, and keeps the input", async () => {
    mockAdd.mockResolvedValue({
      error: { data: { message: "asha@example.com already gets the daily email." } },
    });
    render(<DigestRecipients />);
    const input = screen.getByLabelText("Email address");

    fireEvent.change(input, { target: { value: "asha@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already gets the daily email");
    expect(input).toHaveValue("asha@example.com");
  });

  it("removes an address", async () => {
    render(<DigestRecipients />);

    fireEvent.click(screen.getByRole("button", { name: "Remove asha@example.com" }));

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith("r-1"));
    expect(mockToast.success).toHaveBeenCalledWith(
      "asha@example.com will no longer get the daily email.",
    );
  });
});
