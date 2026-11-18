import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BrandingSettings } from "../BrandingSettings";

const {
  mockTenant,
  mockUser,
  mockUpdateTenant,
  mockUpdateBranding,
  mockPostLogoUrl,
  mockDeleteLogo,
  mockPostFaviconUrl,
  mockRefetch,
} = vi.hoisted(() => ({
  mockTenant: { current: null as any },
  mockUser: { current: { restrictedTenantIds: null as string[] | null } },
  mockUpdateTenant: vi.fn(),
  mockUpdateBranding: vi.fn(),
  mockPostLogoUrl: vi.fn(),
  mockDeleteLogo: vi.fn(),
  mockPostFaviconUrl: vi.fn(),
  mockRefetch: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("axios", () => ({ default: { put: vi.fn().mockResolvedValue({ status: 200 }) } }));

vi.mock("react-redux", () => ({
  useSelector: (select: (state: any) => any) => select({ user: { user: mockUser.current } }),
}));
vi.mock("@store", () => ({}));

vi.mock("@ally-ui-mono/ui-shared", () => ({
  CustomImage: ({ src, alt }: any) => <img src={src} alt={alt} />,
  Tooltip: ({ children }: any) => <>{children}</>,
}));

vi.mock("@assets", () => ({ TooltipIcon: () => <svg data-testid="tooltip-icon" /> }));

vi.mock("@components", () => ({
  ToggleSwitch: ({ enabled, onChange, label, disabled }: any) => (
    <button
      type="button"
      aria-label={label}
      data-testid="branding-switch"
      data-enabled={enabled}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
    >
      {label}
    </button>
  ),
  Button: ({ children, onClick, disabled, variant }: any) => (
    <button type="button" onClick={onClick} disabled={disabled} data-variant={variant}>
      {children}
    </button>
  ),
}));

// The real copy, without the real `@constants` barrel.
vi.mock("@constants", async () => ({
  en: (await import("@src/constants/en")).en,
}));

// The real colour maths, without the real `@utils` barrel.
vi.mock("@utils", async () => await import("@src/utils/brandColour"));

const unwrap = (fn: any) => (arg: any) => ({ unwrap: () => fn(arg) });

vi.mock("@api", () => ({
  useGetTenantByIdQuery: () => ({
    data: mockTenant.current,
    isLoading: mockTenant.current === null,
    refetch: mockRefetch,
  }),
  useUpdateTenantMutation: () => [unwrap(mockUpdateTenant)],
  useUpdateTenantBrandingMutation: () => [unwrap(mockUpdateBranding)],
  usePostLogoUrlMutation: () => [unwrap(mockPostLogoUrl)],
  useDeleteLogoMutation: () => [mockDeleteLogo],
  usePostBrandingFaviconUrlMutation: () => [unwrap(mockPostFaviconUrl)],
}));

const ALLY_BLUE = "#264D8E";

const resolved = (over: Partial<any> = {}) => ({
  enabled: false,
  displayName: "Acme",
  logoUrl: null,
  faviconUrl: null,
  primaryColor: ALLY_BLUE,
  welcomeLine: null,
  poweredByAlly: true,
  tokens: { primary: { 500: ALLY_BLUE }, onPrimary: "#FAF9F5" },
  ...over,
});

const tenant = (over: Partial<any> = {}) => ({
  id: "t1",
  name: "Acme",
  code: "acme",
  logoUrl: "",
  brandingEnabled: false,
  branding: resolved(),
  brandedSignInUrl: "https://app.example/login?org=acme",
  ...over,
});

const onUpdateTenant = vi.fn();
const renderTab = () => render(<BrandingSettings tenantId="t1" onUpdateTenant={onUpdateTenant} />);

beforeEach(() => {
  vi.clearAllMocks();
  mockUser.current = { restrictedTenantIds: null };
  mockTenant.current = tenant();
  mockUpdateTenant.mockResolvedValue({});
  mockUpdateBranding.mockResolvedValue({ branding: resolved({ enabled: true }), warnings: [] });
});

describe("BrandingSettings — org-level switch", () => {
  it("shows a skeleton until the organization has loaded", () => {
    mockTenant.current = null;
    renderTab();
    expect(screen.getByTestId("branding-skeleton")).toBeInTheDocument();
  });

  it("explains the off state and hides the form while the switch is off", () => {
    renderTab();
    expect(screen.getByTestId("branding-off")).toHaveTextContent(
      "Learners see Ally's standard look",
    );
    expect(screen.queryByTestId("branding-preview")).not.toBeInTheDocument();
    expect(screen.getByTestId("branding-switch")).toHaveAttribute("data-enabled", "false");
  });

  it("lets an unrestricted platform admin switch it on through the org edit route", async () => {
    renderTab();
    fireEvent.click(screen.getByTestId("branding-switch"));
    await waitFor(() =>
      expect(mockUpdateTenant).toHaveBeenCalledWith({ id: "t1", data: { brandingEnabled: true } }),
    );
    expect(onUpdateTenant).toHaveBeenCalled();
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("disables the switch for a restricted admin and says who can flip it", () => {
    mockUser.current = { restrictedTenantIds: ["t1"] };
    renderTab();
    expect(screen.getByTestId("branding-switch")).toBeDisabled();
    expect(
      screen.getByText("Only an Ally platform admin can switch branding on or off."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("branding-switch"));
    expect(mockUpdateTenant).not.toHaveBeenCalled();
  });
});

describe("BrandingSettings — editor", () => {
  beforeEach(() => {
    mockTenant.current = tenant({
      brandingEnabled: true,
      logoUrl: "https://x/logo.png",
      branding: resolved({
        enabled: true,
        displayName: "Acme Helpline",
        logoUrl: "https://x/logo.png",
        primaryColor: "#8E2626",
        welcomeLine: "Welcome back",
      }),
    });
  });

  it("shows the branded sign-in link only while the switch is on, and copies it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { unmount } = renderTab();
    expect(screen.getByTestId("branding-sign-in-link")).toHaveTextContent(
      "https://app.example/login?org=acme",
    );
    fireEvent.click(screen.getByText("Copy link"));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("https://app.example/login?org=acme"),
    );
    unmount();

    mockTenant.current = tenant();
    renderTab();
    expect(screen.queryByTestId("branding-sign-in-link")).not.toBeInTheDocument();
  });

  it("loads the stored values and mirrors them in the preview", () => {
    renderTab();
    expect(screen.getByLabelText("Display name")).toHaveValue("Acme Helpline");
    expect(screen.getByLabelText("Brand colour hex")).toHaveValue("#8E2626");
    expect(screen.getByLabelText("Welcome line")).toHaveValue("Welcome back");
    expect(screen.getByTestId("preview-display-name")).toHaveTextContent("Acme Helpline");
    expect(screen.getByTestId("preview-welcome-line")).toHaveTextContent("Welcome back");
    expect(screen.getByTestId("preview-button")).toHaveStyle({ background: "#8E2626" });
  });

  it("treats a display name equal to the org name as unset, with the org name as placeholder", () => {
    mockTenant.current = tenant({
      brandingEnabled: true,
      branding: resolved({ enabled: true, displayName: "Acme" }),
    });
    renderTab();
    expect(screen.getByLabelText("Display name")).toHaveValue("");
    expect(screen.getByLabelText("Display name")).toHaveAttribute("placeholder", "Acme");
    expect(screen.getByTestId("preview-display-name")).toHaveTextContent("Acme");
  });

  it("keeps Save disabled until something changes", () => {
    renderTab();
    expect(screen.getByText("Save")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Welcome line"), { target: { value: "Hi there" } });
    expect(screen.getByText("Save")).toBeEnabled();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByLabelText("Welcome line")).toHaveValue("Welcome back");
    expect(screen.getByText("Save")).toBeDisabled();
  });

  it("reads out contrast as the admin types and blocks a colour under 3:1", () => {
    renderTab();
    const hex = screen.getByLabelText("Brand colour hex");

    fireEvent.change(hex, { target: { value: "#F0EEE7" } });
    expect(screen.getByTestId("contrast-readout")).toHaveAttribute("data-verdict", "fail");
    expect(screen.getByTestId("contrast-readout")).toHaveTextContent("needs at least 3:1");
    expect(screen.getByText("Save")).toBeDisabled();

    fireEvent.change(hex, { target: { value: "#CC5500" } });
    expect(screen.getByTestId("contrast-readout")).toHaveAttribute("data-verdict", "weak");
    expect(screen.getByText("Save")).toBeEnabled();

    fireEvent.change(hex, { target: { value: "#264D8E" } });
    expect(screen.getByTestId("contrast-readout")).toHaveAttribute("data-verdict", "pass");

    fireEvent.change(hex, { target: { value: "blue" } });
    expect(screen.getByTestId("contrast-readout")).toHaveTextContent("Enter a hex colour");
    expect(screen.getByText("Save")).toBeDisabled();
  });

  it("saves a trimmed patch, nulls blanks, and sends Ally Blue as null", async () => {
    renderTab();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "  New Name  " } });
    fireEvent.change(screen.getByLabelText("Welcome line"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("Brand colour hex"), { target: { value: "#264d8e" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(mockUpdateBranding).toHaveBeenCalled());
    expect(mockUpdateBranding).toHaveBeenCalledWith({
      id: "t1",
      data: { displayName: "New Name", primaryColor: null, faviconUrl: null, welcomeLine: null },
    });
    // The logo did not change, so the org edit route is left alone.
    expect(mockUpdateTenant).not.toHaveBeenCalled();
    expect(onUpdateTenant).toHaveBeenCalled();
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("surfaces backend warnings after a save and errors on refusal", async () => {
    const { toast } = await import("sonner");
    mockUpdateBranding.mockResolvedValueOnce({
      branding: resolved({ enabled: true }),
      warnings: [
        "primaryColor passes for buttons and links (3.92:1) but would be hard to read as text.",
      ],
    });
    renderTab();
    fireEvent.change(screen.getByLabelText("Brand colour hex"), { target: { value: "#CC5500" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("3.92:1")),
    );

    mockUpdateBranding.mockRejectedValueOnce({
      data: {
        message: [
          "primaryColor is too close to the page background to read (2.1:1; needs at least 3:1).",
        ],
      },
    });
    // No remount happened (the mocked tenant is unchanged), so pick a colour
    // that differs from both the loaded value and the one just saved.
    fireEvent.change(screen.getByLabelText("Brand colour hex"), { target: { value: "#1A6B3C" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("too close to the page background"),
      ),
    );
  });

  it("uploads a new logo through the presign route and persists it with the org edit on Save", async () => {
    mockPostLogoUrl.mockResolvedValue({
      presignedUrl: "https://s3/put",
      logoUrl: "https://x/new.png",
    });
    renderTab();
    const file = new File(["png"], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("logo-input"), { target: { files: [file] } });
    await waitFor(() => expect(mockPostLogoUrl).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("Save")).toBeEnabled());

    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(mockUpdateTenant).toHaveBeenCalledWith({
        id: "t1",
        data: { logoUrl: "https://x/new.png" },
      }),
    );
    expect(mockDeleteLogo).toHaveBeenCalledWith({ logoUrl: "https://x/logo.png" });
    expect(mockUpdateBranding).toHaveBeenCalled();
  });

  it("refuses an SVG favicon client-side and never asks for a presign", async () => {
    const { toast } = await import("sonner");
    renderTab();
    const svg = new File(["<svg/>"], "icon.svg", { type: "image/svg+xml" });
    fireEvent.change(screen.getByTestId("favicon-input"), { target: { files: [svg] } });
    expect(toast.error).toHaveBeenCalledWith("Favicon must be a PNG, ICO, WebP or JPG file");
    expect(mockPostFaviconUrl).not.toHaveBeenCalled();
  });

  it("uploads a favicon through the org-scoped presign route", async () => {
    mockPostFaviconUrl.mockResolvedValue({
      presignedUrl: "https://s3/put",
      faviconUrl: "https://x/fav.png",
    });
    renderTab();
    const file = new File(["png"], "fav.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("favicon-input"), { target: { files: [file] } });
    await waitFor(() =>
      expect(mockPostFaviconUrl).toHaveBeenCalledWith({
        id: "t1",
        data: { fileName: "fav.png", fileSize: 3, contentType: "image/png" },
      }),
    );
    await waitFor(() => expect(screen.getByText("Remove")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(mockUpdateBranding).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ faviconUrl: "https://x/fav.png" }),
        }),
      ),
    );
  });

  it("asks once before resetting, then clears everything but the logo", async () => {
    renderTab();
    fireEvent.click(screen.getByText("Reset to Ally defaults"));
    expect(mockUpdateBranding).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Confirm reset"));
    await waitFor(() =>
      expect(mockUpdateBranding).toHaveBeenCalledWith({
        id: "t1",
        data: { displayName: null, primaryColor: null, faviconUrl: null, welcomeLine: null },
      }),
    );
    expect(mockUpdateTenant).not.toHaveBeenCalled();
  });

  it("saves the favicon immediately on upload", async () => {
    mockPostFaviconUrl.mockResolvedValue({
      presignedUrl: "https://s3/put",
      faviconUrl: "https://x/fav.png",
    });
    renderTab();

    const file = new File(["png"], "fav.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("favicon-input"), { target: { files: [file] } });

    await waitFor(() =>
      expect(mockUpdateBranding).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ faviconUrl: "https://x/fav.png" }),
        }),
      ),
    );
  });
});
