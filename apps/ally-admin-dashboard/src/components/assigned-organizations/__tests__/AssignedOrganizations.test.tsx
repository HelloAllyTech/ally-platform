import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { toast } from "sonner";
import { AssignedOrganizations } from "../AssignedOrganizations";

// Mock API hooks
vi.mock("@api", () => ({
  useGetAdminTenantsQuery: vi.fn(),
  useGetTenantsQuery: vi.fn(),
  useAssignAdminTenantsMutation: vi.fn(),
  useRemoveAdminTenantsMutation: vi.fn(),
}));

// Mock @ally-ui-mono/ui-shared
vi.mock("@ally-ui-mono/ui-shared", () => ({
  CustomImage: ({ fallbackText, alt }: any) => (
    <div data-testid="custom-image" title={alt}>
      {fallbackText}
    </div>
  ),
}));

// Mock the shared Button (avoids loading the whole @components barrel and its
// transitive @api usage in this unit test).
vi.mock("@components", () => ({
  Button: ({ children, onClick, disabled, className, variant, fullWidth, ...props }: any) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={className}
      data-variant={variant}
      {...props}
    >
      {children}
    </button>
  ),
  ActionConfirmationPopup: ({ isOpen, title, description, primaryButton, secondaryButton }: any) =>
    isOpen ? (
      <div data-testid="confirmation-popup">
        <div>{title}</div>
        <div>{description}</div>
        <button onClick={primaryButton.onClick}>{primaryButton.label}</button>
        <button onClick={secondaryButton.onClick}>{secondaryButton.label}</button>
      </div>
    ) : null,
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock constants
vi.mock("@constants", () => ({
  SORT_ORDER: { ASC: "ASC", DESC: "DESC" },
  en: {
    userManagement: {
      adminFor: "Admin for:",
      addOrganizationLabel: "+ Add Organization",
      noAssignedOrganizations: "No organizations assigned yet",
      remove: "Remove",
      selectOrganizations: "Select organizations to assign",
      noOrganizationsToAdd: "All organizations already assigned",
      noOrganizationsMatch: "No organizations match your search",
      searchOrganizationsPlaceholder: "Search organizations by name or code",
      organizationsTruncated: (shown: number, total: number) =>
        `Showing the first ${shown} of ${total} organizations. Search to find the rest.`,
      cancel: "Cancel",
      confirm: "Confirm",
      removeOrganizationSuccess: "Organization removed successfully",
      removeOrganizationError: "Failed to remove organization",
      liftRestrictionTitle: "Lift the organization restriction?",
      liftRestrictionDescription: (name: string) => `${name} is their last organization.`,
      liftRestrictionConfirm: "Remove and lift restriction",
      assignOrganizationSuccess: "Organization(s) assigned successfully",
      assignOrganizationError: "Failed to assign organization(s)",
    },
    common: {
      loading: "Loading...",
    },
  },
}));

import {
  useGetAdminTenantsQuery,
  useGetTenantsQuery,
  useAssignAdminTenantsMutation,
  useRemoveAdminTenantsMutation,
} from "@api";

describe("AssignedOrganizations", () => {
  const mockUserId = 123;
  const mockAllTenants = [
    { id: "t1", name: "Tenant 1" },
    { id: "t2", name: "Tenant 2" },
    { id: "t3", name: "Tenant 3" },
  ];

  const mockAdminTenants = {
    data: [{ id: "t1", name: "Tenant 1", logoUrl: "" }],
    count: 1,
  };

  const mockAssignMutation = vi
    .fn()
    .mockReturnValue({ unwrap: vi.fn().mockResolvedValue({ success: true }) });
  const mockRemoveMutation = vi
    .fn()
    .mockReturnValue({ unwrap: vi.fn().mockResolvedValue({ success: true }) });

  beforeEach(() => {
    vi.clearAllMocks();
    (useGetAdminTenantsQuery as any).mockReturnValue({
      data: mockAdminTenants,
      isFetching: false,
    });
    // The add modal's server-side search: the three orgs, one already assigned.
    (useGetTenantsQuery as any).mockReturnValue({
      data: { data: mockAllTenants, count: mockAllTenants.length },
      isFetching: false,
    });
    (useAssignAdminTenantsMutation as any).mockReturnValue([
      mockAssignMutation,
      { isLoading: false },
    ]);
    (useRemoveAdminTenantsMutation as any).mockReturnValue([
      mockRemoveMutation,
      { isLoading: false },
    ]);
  });

  it("renders assigned organizations correctly", () => {
    render(<AssignedOrganizations userId={mockUserId} canEdit={true} />);

    expect(screen.getByText("Admin for:")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument(); // count
    expect(screen.getByText("Tenant 1")).toBeInTheDocument();
    expect(screen.getByText("+ Add Organization")).toBeInTheDocument();
  });

  it("shows loading state when fetching", () => {
    (useGetAdminTenantsQuery as any).mockReturnValue({
      data: null,
      isFetching: true,
    });

    render(<AssignedOrganizations userId={mockUserId} canEdit={true} />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows empty state when no organizations assigned", () => {
    (useGetAdminTenantsQuery as any).mockReturnValue({
      data: { data: [], count: 0 },
      isFetching: false,
    });

    render(<AssignedOrganizations userId={mockUserId} canEdit={true} />);

    expect(screen.getByText("No organizations assigned yet")).toBeInTheDocument();
  });

  it("hides Add button and Remove icon when canEdit is false", () => {
    render(<AssignedOrganizations userId={mockUserId} canEdit={false} />);

    expect(screen.queryByText("+ Add Organization")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Remove")).not.toBeInTheDocument();
  });

  it("opens modal and allows assigning new organizations", async () => {
    render(<AssignedOrganizations userId={mockUserId} canEdit={true} />);

    fireEvent.click(screen.getByText("+ Add Organization"));

    // Modal should be visible
    expect(screen.getByText("Select organizations to assign")).toBeInTheDocument();

    // Only t2 and t3 should be available (t1 is already assigned)
    expect(screen.queryByText("Tenant 1")).toBeInTheDocument(); // It's in the background list
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2); // Tenant 2 and Tenant 3 in modal

    // Select Tenant 2
    fireEvent.click(checkboxes[0]);

    // Click Confirm
    fireEvent.click(screen.getByText("Confirm"));

    await waitFor(() => {
      expect(mockAssignMutation).toHaveBeenCalledWith({
        userId: mockUserId,
        tenantIds: ["t2"],
      });
      expect(toast.success).toHaveBeenCalledWith("Organization(s) assigned successfully");
    });
  });

  const twoOrgs = {
    data: [
      { id: "t1", name: "Tenant 1", logoUrl: "" },
      { id: "t2", name: "Tenant 2", logoUrl: "" },
    ],
    count: 2,
  };

  it("allows removing an assigned organization", async () => {
    (useGetAdminTenantsQuery as any).mockReturnValue({ data: twoOrgs, isFetching: false });
    render(<AssignedOrganizations userId={mockUserId} canEdit={true} />);

    fireEvent.click(screen.getAllByTitle("Remove")[0]);

    await waitFor(() => {
      expect(mockRemoveMutation).toHaveBeenCalledWith({
        userId: mockUserId,
        tenantIds: ["t1"],
      });
      expect(toast.success).toHaveBeenCalledWith("Organization removed successfully");
    });
  });

  it("handles assignment error", async () => {
    const errorMutation = vi.fn().mockReturnValue({
      unwrap: vi.fn().mockRejectedValue({ data: { message: "Error assigning" } }),
    });
    (useAssignAdminTenantsMutation as any).mockReturnValue([errorMutation, { isLoading: false }]);

    render(<AssignedOrganizations userId={mockUserId} canEdit={true} />);

    fireEvent.click(screen.getByText("+ Add Organization"));
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByText("Confirm"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Error assigning");
    });
  });

  it("handles removal error", async () => {
    const errorMutation = vi.fn().mockReturnValue({
      unwrap: vi.fn().mockRejectedValue({}),
    });
    (useRemoveAdminTenantsMutation as any).mockReturnValue([errorMutation, { isLoading: false }]);
    (useGetAdminTenantsQuery as any).mockReturnValue({ data: twoOrgs, isFetching: false });

    render(<AssignedOrganizations userId={mockUserId} canEdit={true} />);

    fireEvent.click(screen.getAllByTitle("Remove")[0]);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to remove organization");
    });
  });

  it("asks before removing the last organization, then lifts the restriction", async () => {
    render(<AssignedOrganizations userId={mockUserId} canEdit={true} />);

    fireEvent.click(screen.getByTitle("Remove"));

    expect(screen.getByTestId("confirmation-popup")).toBeInTheDocument();
    expect(screen.getByText("Tenant 1 is their last organization.")).toBeInTheDocument();
    expect(mockRemoveMutation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Remove and lift restriction"));

    await waitFor(() => {
      expect(mockRemoveMutation).toHaveBeenCalledWith({
        userId: mockUserId,
        tenantIds: ["t1"],
        liftRestriction: true,
      });
    });
  });

  it("keeps the last organization when the lift is cancelled", () => {
    render(<AssignedOrganizations userId={mockUserId} canEdit={true} />);

    fireEvent.click(screen.getByTitle("Remove"));
    fireEvent.click(screen.getAllByText("Cancel")[0]);

    expect(screen.queryByTestId("confirmation-popup")).not.toBeInTheDocument();
    expect(mockRemoveMutation).not.toHaveBeenCalled();
  });

  it("searches every organization on the server, not a page the caller loaded", async () => {
    render(<AssignedOrganizations userId={mockUserId} canEdit={true} />);

    fireEvent.click(screen.getByText("+ Add Organization"));
    expect(useGetTenantsQuery).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ search: expect.anything() }),
      { skip: false },
    );

    fireEvent.change(screen.getByLabelText("Search organizations by name or code"), {
      target: { value: "  Tenant 3 " },
    });

    await waitFor(() => {
      expect(useGetTenantsQuery).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "Tenant 3", limit: 50, offset: 0 }),
        { skip: false },
      );
    });
  });

  it("says when more organizations match than it lists", () => {
    (useGetTenantsQuery as any).mockReturnValue({
      data: { data: mockAllTenants, count: 240 },
      isFetching: false,
    });
    render(<AssignedOrganizations userId={mockUserId} canEdit={true} />);

    fireEvent.click(screen.getByText("+ Add Organization"));

    expect(
      screen.getByText("Showing the first 3 of 240 organizations. Search to find the rest."),
    ).toBeInTheDocument();
  });

  it("says when nothing matches the search", async () => {
    render(<AssignedOrganizations userId={mockUserId} canEdit={true} />);
    fireEvent.click(screen.getByText("+ Add Organization"));
    (useGetTenantsQuery as any).mockReturnValue({
      data: { data: [], count: 0 },
      isFetching: false,
    });

    fireEvent.change(screen.getByLabelText("Search organizations by name or code"), {
      target: { value: "zzz" },
    });

    expect(await screen.findByText("No organizations match your search")).toBeInTheDocument();
  });

  it("does not fetch organizations until the add modal opens", () => {
    render(<AssignedOrganizations userId={mockUserId} canEdit={true} />);

    expect(useGetTenantsQuery).toHaveBeenLastCalledWith(expect.anything(), { skip: true });
  });

  it("closes modal on cancel", () => {
    render(<AssignedOrganizations userId={mockUserId} canEdit={true} />);

    fireEvent.click(screen.getByText("+ Add Organization"));
    expect(screen.getByText("Select organizations to assign")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Select organizations to assign")).not.toBeInTheDocument();
  });
});
