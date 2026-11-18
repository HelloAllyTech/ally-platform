import "@constants";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdate, mockLogoUrl, mockDeleteLogo, mockFaviconUrl, mockRefetch, state } = vi.hoisted(
  () => ({
    mockUpdate: vi.fn(),
    mockLogoUrl: vi.fn(),
    mockDeleteLogo: vi.fn(),
    mockFaviconUrl: vi.fn(),
    mockRefetch: vi.fn(),
    state: {
      canEdit: true,
      isLoading: false,
      tenant: undefined as any,
    },
  }),
);

vi.mock("@api", () => ({
  useGetLogoUrlQuery: () => ({ data: state.tenant, refetch: mockRefetch }),
  useUpdateOrgBrandingMutation: () => [mockUpdate],
  useGetOrgLogoUploadUrlMutation: () => [mockLogoUrl],
  useDeleteOrgLogoMutation: () => [mockDeleteLogo],
  useGetOrgFaviconUploadUrlMutation: () => [mockFaviconUrl],
}));

vi.mock("@hooks", async () => {
  const actual = await vi.importActual<typeof import("@hooks")>("@hooks");
  return {
    ...actual,
    useCanEditOrgBranding: () => ({ canEdit: state.canEdit, isLoading: state.isLoading }),
  };
});

vi.mock("../../access-denied/AccessDenied", () => ({
  AccessDenied: () => <div data-testid="access-denied" />,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { toast } from "sonner";

import en from "../../../i18n/locales/en.json";
import { OrgBranding } from "../OrgBranding";

const acme = {
  id: "tenant-1",
  name: "Acme",
  logoUrl: "https://assets.example/logo.png",
  brandedSignInUrl: "https://app.example/login?org=acme",
  branding: {
    enabled: true,
    displayName: "Acme Helpline",
    logoUrl: "https://assets.example/logo.png",
    faviconUrl: null,
    primaryColor: "#8E2626",
    welcomeLine: "Welcome back",
    poweredByAlly: true,
    tokens: { primary: {}, onPrimary: "#FAF9F5" },
  },
};

describe("OrgBranding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.canEdit = true;
    state.isLoading = false;
    state.tenant = acme;
    mockUpdate.mockReturnValue({
      unwrap: () => Promise.resolve({ branding: acme.branding, warnings: [] }),
    });
  });

  it("renders nothing while access is being decided, and Access denied without it", () => {
    state.isLoading = true;
    const { container, unmount } = render(<OrgBranding />);
    expect(container).toBeEmptyDOMElement();
    unmount();

    state.isLoading = false;
    state.canEdit = false;
    render(<OrgBranding />);
    expect(screen.getByTestId("access-denied")).toBeInTheDocument();
  });

  it("loads the org's current values into the form and the preview", () => {
    render(<OrgBranding />);

    expect(screen.getByLabelText(en.orgBranding.displayName)).toHaveValue("Acme Helpline");
    expect(screen.getByLabelText(`${en.orgBranding.primaryColor} hex`)).toHaveValue("#8E2626");
    expect(screen.getByLabelText(en.orgBranding.welcomeLine)).toHaveValue("Welcome back");
    expect(screen.getByTestId("preview-display-name")).toHaveTextContent("Acme Helpline");
    expect(screen.getByTestId("preview-welcome-line")).toHaveTextContent("Welcome back");
    expect(screen.getByTestId("org-branding-sign-in-link")).toHaveTextContent(
      "https://app.example/login?org=acme",
    );
  });

  it("saves the changed fields against the org's own id and refetches", async () => {
    render(<OrgBranding />);

    fireEvent.change(screen.getByLabelText(en.orgBranding.displayName), {
      target: { value: "Acme Training" },
    });
    fireEvent.click(screen.getByText(en.common.save));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith({
      id: "tenant-1",
      data: {
        displayName: "Acme Training",
        primaryColor: "#8E2626",
        faviconUrl: null,
        welcomeLine: "Welcome back",
      },
    });
    await waitFor(() => expect(mockRefetch).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith(en.orgBranding.saved);
    // The logo did not change, so nothing is deleted.
    expect(mockDeleteLogo).not.toHaveBeenCalled();
  });

  it("blocks Save on an unreadable colour and shows why", () => {
    render(<OrgBranding />);

    fireEvent.change(screen.getByLabelText(`${en.orgBranding.primaryColor} hex`), {
      target: { value: "#FAFAFA" },
    });

    expect(screen.getByTestId("contrast-readout")).toHaveAttribute("data-verdict", "fail");
    expect(screen.getByText(en.common.save).closest("button")).toBeDisabled();
  });

  it("asks twice before resetting, then clears everything but the logo", async () => {
    render(<OrgBranding />);

    fireEvent.click(screen.getByText(en.orgBranding.resetToDefaults));
    expect(mockUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(en.orgBranding.resetConfirm));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith({
      id: "tenant-1",
      data: { displayName: null, primaryColor: null, faviconUrl: null, welcomeLine: null },
    });
  });

  it("surfaces the backend's refusal message on a failed save", async () => {
    mockUpdate.mockReturnValue({
      unwrap: () => Promise.reject({ data: { message: "Branding is switched off" } }),
    });
    render(<OrgBranding />);

    fireEvent.change(screen.getByLabelText(en.orgBranding.welcomeLine), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByText(en.common.save));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Branding is switched off"));
    expect(mockRefetch).not.toHaveBeenCalled();
  });
});
