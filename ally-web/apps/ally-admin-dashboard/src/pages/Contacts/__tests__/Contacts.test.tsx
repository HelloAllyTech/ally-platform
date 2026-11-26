import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockContacts, mockMatches, mockContact, mockManagers } = vi.hoisted(() => ({
  mockContacts: vi.fn(),
  mockMatches: vi.fn(),
  mockContact: vi.fn(),
  mockManagers: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock("@api", async importOriginal => {
  const actual = await importOriginal<typeof import("@api")>();
  return {
    ...actual,
    useGetCrmContactsQuery: (...a: any[]) => mockContacts(...a),
    useGetCrmContactMatchesQuery: (...a: any[]) => mockMatches(...a),
    useGetCrmContactQuery: (...a: any[]) => mockContact(...a),
    useGetCrmManagersQuery: (...a: any[]) => mockManagers(...a),
    useCreateCrmContactMutation: () => [vi.fn(), { isLoading: false }],
    useUpdateCrmContactMutation: () => [vi.fn(), { isLoading: false }],
    useDeleteCrmContactMutation: () => [vi.fn(), { isLoading: false }],
    useAddCrmLogMutation: () => [vi.fn(), { isLoading: false }],
    useDeleteCrmLogMutation: () => [vi.fn()],
  };
});

// Same import order the app uses, so the api -> utils -> store cycle resolves.
import "@constants";

import { Contacts } from "../Contacts";
import { formatDay } from "../formatDay";
import { diffFormValues } from "../ContactPanel";

const ada = {
  id: "c-1",
  fullName: "Ada Lovelace",
  organization: "Analytical Engines",
  jobTitle: "Founder",
  notes: "Met at a conference",
  relationshipManagerId: 7,
  relationshipManagerName: "Zed",
  createdAt: "2026-11-20T10:00:00Z",
  updatedAt: "2026-11-20T10:00:00Z",
  lastLoggedOn: "2026-11-25",
  logCount: 1,
};

describe("Contacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContacts.mockReturnValue({ data: { contacts: [ada] }, isLoading: false, isError: false });
    mockMatches.mockReturnValue({ data: { contacts: [] } });
    mockContact.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    mockManagers.mockReturnValue({ data: { managers: [{ userId: 7, name: "Zed" }] } });
  });

  it("lists contacts with organization, job title and manager", () => {
    render(<Contacts />);

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Analytical Engines")).toBeInTheDocument();
    expect(screen.getByText("Founder")).toBeInTheDocument();
    expect(screen.getByText("Zed")).toBeInTheDocument();
  });

  it("says so when there are no contacts", () => {
    mockContacts.mockReturnValue({ data: { contacts: [] }, isLoading: false, isError: false });
    render(<Contacts />);

    expect(screen.getByText(/No contacts yet/)).toBeInTheDocument();
  });

  it("opens a blank form from Add contact and lists the manager choices", () => {
    render(<Contacts />);
    fireEvent.click(screen.getByTestId("add-contact"));

    expect(screen.getByText("New contact")).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Unassigned" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Zed" })).toBeInTheDocument();
  });

  it("opens an existing contact with its log", () => {
    mockContact.mockReturnValue({
      data: { ...ada, logs: [] },
      isLoading: false,
      isError: false,
    });
    render(<Contacts />);
    fireEvent.click(screen.getByText("Ada Lovelace"));

    expect(screen.getByDisplayValue("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByTestId("crm-log")).toBeInTheDocument();
  });
});

describe("formatDay", () => {
  it("keeps the calendar day whatever the timezone", () => {
    expect(formatDay("2026-11-26")).toBe("26 Nov 2026");
  });
});

describe("diffFormValues", () => {
  const base = {
    fullName: "Ada",
    organization: "",
    jobTitle: "",
    notes: "",
    managerId: "7",
  };

  it("sends only what changed", () => {
    expect(diffFormValues({ ...base, notes: "hi" }, base)).toEqual({ notes: "hi" });
  });

  it("clears the manager with null", () => {
    expect(diffFormValues({ ...base, managerId: "" }, base)).toEqual({
      relationshipManagerId: null,
    });
  });
});
