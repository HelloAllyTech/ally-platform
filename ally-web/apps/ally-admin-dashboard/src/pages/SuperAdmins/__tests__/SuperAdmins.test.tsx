import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { SuperAdmins } from "../SuperAdmins";

const mockAssignPlatformAdmin = vi.fn();
const mockRemovePlatformAdmin = vi.fn();
const mockSetUserFeatureToggles = vi.fn();
const mockAddAdvisor = vi.fn(() => ({ unwrap: () => Promise.resolve({}) }));
const mockRemoveAdvisor = vi.fn(() => ({ unwrap: () => Promise.resolve({}) }));
const mockAddOwner = vi.fn(() => ({ unwrap: () => Promise.resolve({}) }));
const mockRemoveOwner = vi.fn(() => ({ unwrap: () => Promise.resolve({}) }));
// Admin 2 is a clinical advisor; admin 1 holds no Debrief role.
const debriefPeople = [
  {
    userId: 2,
    name: "Other Admin",
    email: "other@helloally.ai",
    organisation: null,
    roles: ["PLATFORM_ADMIN", "CLINICAL_ADVISOR"],
    advisor: true,
    owner: false,
    signOff: true,
  },
];

// `createdAt` and `roleGrantedAt` are deliberately months apart on every
// fixture: the "Added on" column must show the role grant, and rendering the
// account date there is the bug this pair of dates guards against.
const platformAdmins = [
  {
    id: 1,
    name: "Current Admin",
    email: "me@helloally.ai",
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00Z",
    roleGrantedAt: "2026-07-15T00:00:00Z",
  },
  {
    id: 2,
    name: "Other Admin",
    email: "other@helloally.ai",
    status: "ACTIVE",
    createdAt: "2026-02-01T00:00:00Z",
    roleGrantedAt: "2026-08-02T00:00:00Z",
  },
];

const candidates = [
  {
    id: 5,
    name: "Eligible User",
    email: "eligible@helloally.ai",
    status: "ACTIVE",
    createdAt: "2026-04-01T00:00:00Z",
    roleGrantedAt: "2026-04-01T00:00:00Z",
  },
];

/** Same formatting the component uses, so the assertion is locale-agnostic. */
const asDisplayed = (iso: string) => new Date(iso).toLocaleDateString();

// Labels deliberately differ from their section names ("Analytics" /
// "Platform Config") so assertions on one can't accidentally match the other.
const toggles = [
  {
    key: "analytics",
    label: "View Analytics",
    description: "View analytics dashboards",
    enabled: true,
    platformOnly: true,
  },
  {
    key: "settings",
    label: "Manage Settings",
    description: "Manage platform settings",
    enabled: false,
  },
];

// The organizations the opened admin is restricted to; none = unrestricted.
let adminTenantCount = 0;

// Roadmap v2's role radio (§3.2): answered only for an Owner while roadmap_v2 is on.
const mockSetRoadmapRole = vi.fn();
let roadmapRoleEntry: Record<string, unknown> | undefined;
let roadmapRoleList: { users: Record<string, unknown>[] } | undefined;
const roadmapToggles = [
  { key: "product_roadmap", label: "Product Roadmap", description: "", enabled: true },
  { key: "builder", label: "Builder", description: "", enabled: true },
  { key: "product_roadmap_manage", label: "Roadmap manage", description: "", enabled: false },
];
let allToggles: { key: string; label: string; description: string; enabled: boolean }[] = [];
const withToggles = (extra: typeof roadmapToggles) => {
  allToggles = [...toggles, ...extra];
};

// Mocking @components (with cellTypes) sidesteps the @constants ↔ @components
// circular import that breaks under vitest, same as UserManagement.test.tsx.
vi.mock("@components", () => ({
  cellTypes: {
    editableText: "editableText",
    dropdown: "dropdown",
    dropdownSearchable: "dropdownSearchable",
    number: "number",
    select: "select",
    switch: "switch",
    emoji_select: "emoji_select",
    normalText: "normalText",
  },
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  ListToolbar: ({ searchValue, onSearchChange, action }: any) => (
    <div data-testid="list-toolbar">
      <input
        data-testid="search-input"
        value={searchValue}
        onChange={e => onSearchChange(e.target.value)}
        placeholder="Search"
      />
      {action && <button onClick={action.onClick}>{action.label}</button>}
    </div>
  ),
  EmptyState: ({ title }: any) => <div data-testid="empty-state">{title}</div>,
  StatusBadge: ({ status }: any) => <span>{status}</span>,
  ActionConfirmationPopup: ({ isOpen, title, description, primaryButton, secondaryButton }: any) =>
    isOpen ? (
      <div data-testid="confirmation-popup">
        <div>{title}</div>
        <div>{description}</div>
        <button onClick={primaryButton.onClick}>{primaryButton.label}</button>
        {secondaryButton && (
          <button onClick={secondaryButton.onClick}>{secondaryButton.label}</button>
        )}
      </div>
    ) : null,
  // Matches the real component: `label` is an accessible name (aria-label),
  // not visible text — visible text lives in the row's own <p>, and rendering
  // it twice would make text queries ambiguous.
  ToggleSwitch: ({ enabled, onChange, label }: any) => (
    <button
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={() => onChange(!enabled)}
    />
  ),
  AssignedOrganizations: () => (
    <div data-testid="assigned-organizations">Assigned Organizations</div>
  ),
}));

vi.mock("@assets", () => ({
  ArrowDown: () => <svg data-testid="arrow-down" />,
  TooltipIcon: () => <svg data-testid="tooltip-icon" />,
}));

vi.mock("@api", () => ({
  useListPlatformAdminsQuery: () => ({
    data: { data: platformAdmins, count: 2 },
    isLoading: false,
  }),
  useListEligiblePlatformAdminsQuery: () => ({
    data: { data: candidates, count: 1 },
    isFetching: false,
  }),
  useAssignPlatformAdminMutation: () => [mockAssignPlatformAdmin],
  useRemovePlatformAdminMutation: () => [mockRemovePlatformAdmin],
  // A stable array per test: a fresh one each render would loop the page's sync effect.
  useGetUserFeatureTogglesQuery: () => ({ data: allToggles, isLoading: false }),
  useGetRoadmapRoleForQuery: () => ({ data: roadmapRoleEntry }),
  useListRoadmapRolesQuery: () => ({ data: roadmapRoleList }),
  useSetRoadmapRoleForMutation: () => [mockSetRoadmapRole, { isLoading: false }],
  useSetUserFeatureTogglesMutation: () => [mockSetUserFeatureToggles],
  useGetTenantsQuery: () => ({ data: { data: [], count: 0 } }),
  useGetAdminTenantsQuery: () => ({ data: { data: [], count: adminTenantCount } }),
  useListClinicalAdvisorsQuery: () => ({ data: debriefPeople, isLoading: false, isError: false }),
  useAddClinicalAdvisorMutation: () => [mockAddAdvisor],
  useRemoveClinicalAdvisorMutation: () => [mockRemoveAdvisor],
  useAddDebriefOwnerMutation: () => [mockAddOwner],
  useRemoveDebriefOwnerMutation: () => [mockRemoveOwner],
}));

vi.mock("react-redux", () => ({
  useSelector: (selector: any) => selector({ user: { user: { id: 1 } } }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("SuperAdmins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const resolved = { unwrap: () => Promise.resolve({ success: true }) };
    mockAssignPlatformAdmin.mockReturnValue(resolved);
    mockRemovePlatformAdmin.mockReturnValue(resolved);
    mockSetUserFeatureToggles.mockReturnValue(resolved);
    mockSetRoadmapRole.mockReturnValue(resolved);
    roadmapRoleEntry = undefined;
    roadmapRoleList = undefined;
    withToggles([]);
  });

  it("shows everyone's Roadmap role in one column, for an Owner only", () => {
    const { unmount } = render(<SuperAdmins />);
    expect(screen.queryByText("Roadmap role")).not.toBeInTheDocument();
    unmount();
    roadmapRoleList = {
      users: [
        { userId: 1, name: "Current Admin", role: "owner", restricted: false, setting: "owner" },
        { userId: 2, name: "Other Admin", role: "builder", restricted: false, setting: "builder" },
      ],
    };
    render(<SuperAdmins />);
    expect(screen.getByText("Roadmap role")).toBeInTheDocument();
    expect(screen.getAllByTestId("sa-roadmap-role").map(cell => cell.textContent)).toEqual([
      "Owner",
      "Builder",
    ]);
  });

  it("renders the platform admins list", () => {
    render(<SuperAdmins />);
    expect(screen.getAllByTestId("sa-row")).toHaveLength(2);
    expect(screen.getByText("Current Admin")).toBeInTheDocument();
    expect(screen.getByText("Other Admin")).toBeInTheDocument();
  });

  it("dates the 'Added on' column from the role grant, not the account", () => {
    render(<SuperAdmins />);
    expect(screen.getByText(asDisplayed("2026-07-15T00:00:00Z"))).toBeInTheDocument();
    expect(screen.getByText(asDisplayed("2026-08-02T00:00:00Z"))).toBeInTheDocument();
    // The account-creation dates must not appear — showing them here is what
    // made the column read as an admin-grant audit trail when it wasn't.
    expect(screen.queryByText(asDisplayed("2026-01-01T00:00:00Z"))).not.toBeInTheDocument();
    expect(screen.queryByText(asDisplayed("2026-02-01T00:00:00Z"))).not.toBeInTheDocument();
  });

  it("removes a platform admin after confirmation", () => {
    render(<SuperAdmins />);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    expect(screen.getByText("Remove platform admin?")).toBeInTheDocument();
    const removeButtons = screen.getAllByRole("button", { name: "Remove" });
    fireEvent.click(removeButtons[removeButtons.length - 1]);
    expect(mockRemovePlatformAdmin).toHaveBeenCalledWith(1);
  });

  it("adds a new platform admin from the candidate panel after confirmation", () => {
    render(<SuperAdmins />);
    fireEvent.click(screen.getByRole("button", { name: "Add platform admin" }));
    expect(screen.getByText("Eligible User")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio"));
    const addButtons = screen.getAllByRole("button", { name: "Add platform admin" });
    fireEvent.click(addButtons[addButtons.length - 1]);
    expect(screen.getByText("Add platform admin?")).toBeInTheDocument();

    const confirmButtons = screen.getAllByRole("button", { name: "Add platform admin" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    expect(mockAssignPlatformAdmin).toHaveBeenCalledWith({ userId: 5 });
  });

  it("disables the add button until a candidate is selected", () => {
    render(<SuperAdmins />);
    fireEvent.click(screen.getByRole("button", { name: "Add platform admin" }));
    const addButtons = screen.getAllByRole("button", { name: "Add platform admin" });
    expect(addButtons[addButtons.length - 1]).toBeDisabled();
  });

  it("opens the toggle detail view on row click, grouped with sections", () => {
    render(<SuperAdmins />);
    fireEvent.click(screen.getByText("Current Admin"));

    // Section headers ("Analytics", "Platform Config") plus each toggle's own label.
    expect(screen.getByText("Analytics")).toBeInTheDocument();
    expect(screen.getByText("Platform Config")).toBeInTheDocument();
    expect(screen.getByText("View Analytics")).toBeInTheDocument();
    expect(screen.getByText("Manage Settings")).toBeInTheDocument();
    expect(screen.getByTestId("assigned-organizations")).toBeInTheDocument();
  });

  it("flips a toggle immediately with an optimistic update", () => {
    render(<SuperAdmins />);
    fireEvent.click(screen.getByText("Current Admin"));

    const settingsSwitch = screen.getByRole("switch", { name: "Manage Settings" });
    expect(settingsSwitch).toHaveAttribute("aria-checked", "false");

    fireEvent.click(settingsSwitch);

    expect(mockSetUserFeatureToggles).toHaveBeenCalledWith({
      userId: 1,
      toggles: [{ featureKey: "settings", enabled: true }],
    });
  });

  it("says a platform-only toggle is off while the admin is restricted to organizations", () => {
    adminTenantCount = 1;
    render(<SuperAdmins />);
    fireEvent.click(screen.getByText("Current Admin"));

    // Once, on the platform-only "View Analytics" row — not on "Manage Settings".
    expect(screen.getAllByText(/Off while this admin is restricted/)).toHaveLength(1);
  });

  it("shows no such note for an unrestricted admin", () => {
    adminTenantCount = 0;
    render(<SuperAdmins />);
    fireEvent.click(screen.getByText("Current Admin"));

    expect(screen.queryByText(/Off while this admin is restricted/)).not.toBeInTheDocument();
  });

  it("returns to the list view from the detail view", () => {
    render(<SuperAdmins />);
    fireEvent.click(screen.getByText("Current Admin"));
    expect(screen.getByText("View Analytics")).toBeInTheDocument();

    fireEvent.click(screen.getAllByText("Back to platform admins")[0]);
    expect(screen.getAllByTestId("sa-row")).toHaveLength(2);
  });

  it("shows each admin's Debrief roles as badges beside the name", () => {
    render(<SuperAdmins />);
    const badges = screen.getAllByTestId("sa-debrief-role");
    expect(badges.map(b => b.textContent)).toEqual(["Clinical advisor"]);
  });

  it("switches an admin's Debrief roles on their page, at once", () => {
    render(<SuperAdmins />);
    fireEvent.click(screen.getByText("Other Admin"));
    const advisor = screen.getByTestId("admin-debrief-role-advisor");
    const owner = screen.getByTestId("admin-debrief-role-owner");
    expect(advisor).toHaveTextContent("Clinical advisor");
    expect(owner).toHaveTextContent("Debrief owner");
    // Advisor is on, so the switch removes it; owner is off, so it grants it.
    fireEvent.click(advisor.querySelector("button")!);
    expect(mockRemoveAdvisor).toHaveBeenCalledWith(2);
  });

  it("grants the Debrief owner role from its switch", () => {
    render(<SuperAdmins />);
    fireEvent.click(screen.getByText("Current Admin"));
    fireEvent.click(screen.getByTestId("admin-debrief-role-owner").querySelector("button")!);
    expect(mockAddOwner).toHaveBeenCalledWith(1);
  });

  describe("Roadmap role radio (roadmap_v2 on, caller is an Owner)", () => {
    it("is absent while the role route doesn't answer, and the three toggles stay", () => {
      withToggles(roadmapToggles);
      render(<SuperAdmins />);
      fireEvent.click(screen.getByText("Other Admin"));
      expect(screen.queryByTestId("admin-roadmap-role")).not.toBeInTheDocument();
      expect(screen.getByRole("switch", { name: "Builder" })).toBeInTheDocument();
    });

    it("replaces the three toggles with one radio, and writes the role in one call", () => {
      withToggles(roadmapToggles);
      roadmapRoleEntry = {
        userId: 2,
        name: "Other Admin",
        role: "builder",
        restricted: false,
        setting: "builder",
      };
      render(<SuperAdmins />);
      fireEvent.click(screen.getByText("Other Admin"));
      const group = screen.getByRole("radiogroup", { name: "Roadmap role" });
      expect(group).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Builder" })).toBeChecked();
      // The toggles the radio writes are not offered separately.
      expect(screen.queryByRole("switch", { name: "Builder" })).not.toBeInTheDocument();
      expect(screen.queryByRole("switch", { name: "Roadmap manage" })).not.toBeInTheDocument();
      expect(screen.getByRole("switch", { name: "Manage Settings" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("radio", { name: "Owner" }));
      expect(mockSetRoadmapRole).toHaveBeenCalledWith({ userId: 2, role: "owner" });
      expect(mockSetUserFeatureToggles).not.toHaveBeenCalled();
    });

    it("can't change your own role, so the last Owner never removes themselves", () => {
      roadmapRoleEntry = {
        userId: 1,
        name: "Current Admin",
        role: "owner",
        restricted: false,
        setting: "owner",
      };
      render(<SuperAdmins />);
      fireEvent.click(screen.getByText("Current Admin"));
      const none = screen.getByRole("radio", { name: "None" });
      expect(none).toBeDisabled();
      fireEvent.click(none);
      expect(mockSetRoadmapRole).not.toHaveBeenCalled();
      expect(screen.getByText("You can't change your own role.")).toBeInTheDocument();
    });

    it("says an org-restricted admin stays a Viewer whatever is picked", () => {
      roadmapRoleEntry = {
        userId: 2,
        name: "Other Admin",
        role: "viewer",
        restricted: true,
        setting: "idea",
      };
      render(<SuperAdmins />);
      fireEvent.click(screen.getByText("Other Admin"));
      expect(screen.getByText(/a Viewer whatever is picked here/)).toBeInTheDocument();
    });
  });
});
