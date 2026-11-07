import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TenantBranding } from "@types";

import { applyBranding } from "../applyBranding";
import { ALLY_BRANDING, useApplyBranding, useBranding } from "../BrandingContext";
import { BrandingProvider } from "../BrandingProvider";

const { state, mockTenant, mockPublic } = vi.hoisted(() => ({
  state: { isAuthenticated: false },
  mockTenant: { data: undefined as any },
  mockPublic: { data: undefined as any, isError: false, lastArg: null as any },
}));

vi.mock("react-redux", () => ({
  useSelector: (select: (s: any) => any) => select({ user: state }),
}));
vi.mock("@store", () => ({}));
vi.mock("@api", () => ({
  useGetLogoUrlQuery: (_arg: unknown, opts?: { skip?: boolean }) =>
    opts?.skip ? { data: undefined } : { data: mockTenant.data },
  useGetPublicBrandingQuery: (arg: string, opts?: { skip?: boolean }) => {
    mockPublic.lastArg = opts?.skip ? null : arg;
    return opts?.skip
      ? { data: undefined, isError: false }
      : { data: mockPublic.data, isError: mockPublic.isError };
  },
}));

const acme: TenantBranding = {
  ...ALLY_BRANDING,
  enabled: true,
  displayName: "Acme Helpline",
  primaryColor: "#8E2626",
  tokens: {
    primary: { ...ALLY_BRANDING.tokens.primary, DEFAULT: "#8E2626", 500: "#8E2626" },
    onPrimary: "#FAF9F5",
  },
};

const Probe = () => {
  const { branding, enabled } = useBranding();
  return (
    <div data-testid="probe" data-enabled={enabled}>
      {branding.displayName}
    </div>
  );
};

const primary500 = () => document.documentElement.style.getPropertyValue("--color-primary-500");

const renderProvider = () =>
  render(
    <BrandingProvider>
      <Probe />
    </BrandingProvider>,
  );

beforeEach(() => {
  state.isAuthenticated = false;
  mockTenant.data = undefined;
  mockPublic.data = undefined;
  mockPublic.isError = false;
  mockPublic.lastArg = null;
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/login");
  applyBranding(null);
});

afterEach(() => {
  applyBranding(null);
});

describe("BrandingProvider", () => {
  it("defaults to Ally and clears any cached brand when nobody is signed in and no org is on the link", () => {
    localStorage.setItem("orgBranding", JSON.stringify(acme));
    renderProvider();

    expect(screen.getByTestId("probe")).toHaveTextContent("Ally");
    expect(screen.getByTestId("probe")).toHaveAttribute("data-enabled", "false");
    expect(localStorage.getItem("orgBranding")).toBeNull();
    expect(mockPublic.lastArg).toBeNull();
  });

  it("paints and caches the signed-in user's org when its switch is on", () => {
    state.isAuthenticated = true;
    mockTenant.data = { name: "Acme", logoUrl: "", branding: acme };
    renderProvider();

    expect(screen.getByTestId("probe")).toHaveTextContent("Acme Helpline");
    expect(screen.getByTestId("probe")).toHaveAttribute("data-enabled", "true");
    expect(primary500()).toBe("142 38 38");
    expect(JSON.parse(localStorage.getItem("orgBranding") ?? "null")?.displayName).toBe(
      "Acme Helpline",
    );
  });

  it("stays on Ally for a signed-in org with the switch off, even with stored values", () => {
    state.isAuthenticated = true;
    mockTenant.data = {
      name: "Acme",
      logoUrl: "",
      branding: { ...acme, enabled: false, displayName: "Acme" },
    };
    renderProvider();

    expect(screen.getByTestId("probe")).toHaveAttribute("data-enabled", "false");
    expect(primary500()).toBe("");
    expect(localStorage.getItem("orgBranding")).toBeNull();
  });

  it("keeps the pre-painted cache while the tenant request is still in flight", () => {
    state.isAuthenticated = true;
    mockTenant.data = undefined;
    applyBranding(acme);
    renderProvider();

    expect(primary500()).toBe("142 38 38");
    // The context, though, never claims a brand it has not confirmed.
    expect(screen.getByTestId("probe")).toHaveAttribute("data-enabled", "false");
  });

  it("brands the sign-in page from ?org=<code> and keeps the code for the tab", () => {
    window.history.replaceState({}, "", "/login?org=acme");
    mockPublic.data = acme;
    renderProvider();

    expect(mockPublic.lastArg).toBe("acme");
    expect(screen.getByTestId("probe")).toHaveTextContent("Acme Helpline");
    expect(primary500()).toBe("142 38 38");
    expect(sessionStorage.getItem("loginOrgCode")).toBe("acme");
  });

  it("reuses the tab's org code after a bounce back to a plain /login", () => {
    sessionStorage.setItem("loginOrgCode", "acme");
    mockPublic.data = acme;
    renderProvider();

    expect(mockPublic.lastArg).toBe("acme");
    expect(screen.getByTestId("probe")).toHaveTextContent("Acme Helpline");
  });

  it("falls back to Ally when the org code is unknown", () => {
    window.history.replaceState({}, "", "/login?org=nope");
    mockPublic.isError = true;
    renderProvider();

    expect(screen.getByTestId("probe")).toHaveTextContent("Ally");
    expect(primary500()).toBe("");
  });

  it("never asks the public route while signed in", () => {
    window.history.replaceState({}, "", "/login?org=acme");
    state.isAuthenticated = true;
    mockTenant.data = { name: "Acme", logoUrl: "", branding: acme };
    renderProvider();

    expect(mockPublic.lastArg).toBeNull();
  });
});

describe("useApplyBranding (a route that brands itself)", () => {
  const Talker = ({ branding }: { branding: TenantBranding | null | undefined }) => {
    useApplyBranding(branding);
    return <div data-testid="talker" />;
  };

  it("paints its own org and keeps the provider from clearing it", () => {
    render(
      <BrandingProvider>
        <Talker branding={acme} />
      </BrandingProvider>,
    );
    expect(primary500()).toBe("142 38 38");
  });

  it("leaves the page as it is while loading, and goes to Ally for a disabled org", () => {
    applyBranding(acme);
    const { rerender } = render(<Talker branding={undefined} />);
    expect(primary500()).toBe("142 38 38");

    rerender(<Talker branding={{ ...acme, enabled: false }} />);
    expect(primary500()).toBe("");
  });

  it("hands the document back to the cached brand on unmount", () => {
    localStorage.setItem("orgBranding", JSON.stringify(acme));
    const { unmount } = render(<Talker branding={null} />);
    expect(primary500()).toBe("");

    unmount();
    expect(primary500()).toBe("142 38 38");
  });
});
