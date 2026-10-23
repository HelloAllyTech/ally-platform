import React from "react";

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import LoginDialog from "../LoginDialog";

// Simplify motion wrappers
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

vi.mock("@assets", () => ({
  BackCircle: (props: any) => <button data-testid="back" {...props} />,
  CloseIcon: (props: any) => <button data-testid="close" {...props} />,
}));

// Mock API hooks
const {
  mockGenerate,
  mockVerify,
  mockPutTerms,
  mockCheckAuth,
  mockGoogleSignIn,
  mockToastError,
  verifyState,
} = vi.hoisted(() => ({
  mockGenerate: vi.fn(),
  mockVerify: vi.fn(),
  mockPutTerms: vi.fn(),
  mockCheckAuth: vi.fn(),
  mockGoogleSignIn: vi.fn(),
  mockToastError: vi.fn(),
  // What the verify mutation reports; a test flips it to a verified code.
  verifyState: {
    current: { isLoading: false, isSuccess: false } as Record<string, unknown>,
  },
}));
vi.mock("@api", () => ({
  useGenerateOTPMutation: () => [mockGenerate, { isLoading: false, isSuccess: false }],
  useVerifyOTPMutation: () => [mockVerify, verifyState.current],
  usePutTermsAndAgreementMutation: () => [mockPutTerms],
  useGoogleSignInMutation: () => [mockGoogleSignIn, { isLoading: false }],
}));

vi.mock("sonner", () => ({ toast: { error: mockToastError } }));

// Google's popup hands back an access token as soon as the button is pressed.
vi.mock("@react-oauth/google", () => ({
  useGoogleLogin:
    ({ onSuccess }: any) =>
    () =>
      onSuccess({ access_token: "google-access-token" }),
  GoogleLogin: () => null,
}));

// Mock user hook
vi.mock("@hooks", () => ({
  useUser: () => ({ checkAuth: mockCheckAuth }),
}));

// The terms modal pulls in the whole components barrel; stand in for it.
vi.mock("../../terms-and-agreement/TermsAndAgreement", () => ({
  default: ({ isOpen, handleAgreeButtonClick }: any) =>
    isOpen ? (
      <div data-testid="terms">
        <button onClick={handleAgreeButtonClick}>agree-to-terms</button>
      </div>
    ) : null,
}));

// Mock utils
const openLinkSpy = vi.fn();
vi.mock("@utils", () => ({
  openLinkInNewTab: (url: string) => openLinkSpy(url),
  validateEmail: (email: string) => /.+@.+\..+/.test(email),
}));

// Mock constants to stable URLs — direct mock to avoid loading the real barrel
// (common.ts imports Carousel1 from @assets which is mocked without it)
vi.mock("@constants", () => ({
  ALLY_TERMS_URL: "https://example.com/terms",
  ALLY_PRIVACY_POLICY_URL: "https://example.com/privacy",
  LOCAL_STORAGE_KEYS: {
    ACCESS_TOKEN: "accessToken",
    REFRESH_TOKEN: "refreshToken",
    ROOM_DATA: "roomData",
  },
  LoginSection: {
    EMAIL: "Email",
    OTP: "OTP",
  },
}));

// Mock child components used by LoginDialog
vi.mock("../../button", () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("../../text-field", () => ({
  default: ({ label, value, onChange, placeholder, errorMessage }: any) => (
    <div>
      <label>{label}</label>
      <input aria-label={label} value={value} onChange={onChange} placeholder={placeholder} />
      {errorMessage ? <div role="alert">{errorMessage}</div> : null}
    </div>
  ),
}));

vi.mock("../../otp", () => ({
  default: ({ value, onChange }: any) => (
    <input aria-label="otp" value={value} onChange={e => onChange(e.target.value)} />
  ),
}));

describe("LoginDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    verifyState.current = { isLoading: false, isSuccess: false };
    vi.stubEnv("VITE_GOOGLE_AUTH_CLIENT_ID", "test-client-id");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const verifiedCode = () => {
    verifyState.current = {
      isLoading: false,
      isSuccess: true,
      data: { accessToken: "access", refreshToken: "refresh" },
    };
  };

  it("signs in as soon as the code is verified by default", async () => {
    verifiedCode();
    const onSuccess = vi.fn();
    render(<LoginDialog isOpen onClose={vi.fn()} onSuccess={onSuccess} />);

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(localStorage.getItem("accessToken")).toBe("access");
    expect(screen.queryByTestId("terms")).toBeNull();
  });

  it("with requireTerms, signs in only once the terms are accepted", async () => {
    verifiedCode();
    mockPutTerms.mockResolvedValue({ data: { success: true } });
    const onSuccess = vi.fn();
    render(<LoginDialog isOpen onClose={vi.fn()} onSuccess={onSuccess} requireTerms />);

    await waitFor(() => expect(screen.getByTestId("terms")).toBeTruthy());
    expect(localStorage.getItem("accessToken")).toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("agree-to-terms"));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(mockPutTerms).toHaveBeenCalledWith({ token: "access" });
    expect(mockCheckAuth).toHaveBeenCalled();
    expect(localStorage.getItem("accessToken")).toBe("access");
    expect(localStorage.getItem("refreshToken")).toBe("refresh");
  });

  it("with requireTerms, stays signed out when accepting the terms fails", async () => {
    verifiedCode();
    mockPutTerms.mockResolvedValue({ data: { success: false } });
    const onSuccess = vi.fn();
    render(<LoginDialog isOpen onClose={vi.fn()} onSuccess={onSuccess} requireTerms />);

    await waitFor(() => expect(screen.getByTestId("terms")).toBeTruthy());
    fireEvent.click(screen.getByText("agree-to-terms"));

    await waitFor(() => expect(mockPutTerms).toHaveBeenCalled());
    expect(onSuccess).not.toHaveBeenCalled();
    expect(localStorage.getItem("accessToken")).toBeNull();
    expect(screen.getByTestId("terms")).toBeTruthy();
  });

  it("signs in with Google straight away by default", async () => {
    mockGoogleSignIn.mockResolvedValue({
      data: { accessToken: "g-access", refreshToken: "g-refresh" },
    });
    const onSuccess = vi.fn();
    render(<LoginDialog isOpen onClose={vi.fn()} onSuccess={onSuccess} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(mockGoogleSignIn).toHaveBeenCalledWith({ accessToken: "google-access-token" });
    expect(localStorage.getItem("accessToken")).toBe("g-access");
    expect(localStorage.getItem("refreshToken")).toBe("g-refresh");
  });

  it("with requireTerms, a Google sign-in waits for the terms like the code does", async () => {
    mockGoogleSignIn.mockResolvedValue({
      data: { accessToken: "g-access", refreshToken: "g-refresh" },
    });
    mockPutTerms.mockResolvedValue({ data: { success: true } });
    const onSuccess = vi.fn();
    render(<LoginDialog isOpen onClose={vi.fn()} onSuccess={onSuccess} requireTerms />);

    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    await waitFor(() => expect(screen.getByTestId("terms")).toBeTruthy());
    expect(localStorage.getItem("accessToken")).toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("agree-to-terms"));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(mockPutTerms).toHaveBeenCalledWith({ token: "g-access" });
    expect(localStorage.getItem("accessToken")).toBe("g-access");
  });

  it("shows the server's reason when a Google sign-in is refused, and stays signed out", async () => {
    mockGoogleSignIn.mockResolvedValue({
      error: { status: 404, data: { message: "No account found associated with this email" } },
    });
    const onSuccess = vi.fn();
    render(<LoginDialog isOpen onClose={vi.fn()} onSuccess={onSuccess} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith("No account found associated with this email"),
    );
    expect(onSuccess).not.toHaveBeenCalled();
    expect(localStorage.getItem("accessToken")).toBeNull();
  });

  it("leaves Google out when no Google client is configured", () => {
    vi.stubEnv("VITE_GOOGLE_AUTH_CLIENT_ID", "");
    render(<LoginDialog isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();
    expect(screen.queryByText("OR")).toBeNull();
  });

  it("renders email section and validates email before generating OTP", () => {
    render(<LoginDialog isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);

    const nextBtn = screen.getByRole("button", { name: /Next|Generating OTP/i });
    expect(nextBtn).toBeDisabled();

    const emailInput = screen.getByLabelText("Email");
    fireEvent.change(emailInput, { target: { value: "invalid" } });
    fireEvent.click(nextBtn);

    expect(screen.getByRole("alert")).toHaveTextContent("Please enter a valid email address");
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("always remembers the email, with no Remember me box to tick", () => {
    render(<LoginDialog isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.queryByLabelText(/Remember me/i)).toBeNull();

    const emailInput = screen.getByLabelText("Email");
    fireEvent.change(emailInput, { target: { value: "  USER@EXAMPLE.COM  " } });

    const nextBtn = screen.getByRole("button", { name: "Next" });
    fireEvent.click(nextBtn);

    expect(localStorage.getItem("rememberedEmail")).toBe("user@example.com");
    expect(mockGenerate).toHaveBeenCalledWith({ email: "user@example.com" });
  });

  it("opens links for terms and privacy", () => {
    render(<LoginDialog isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByText(/Terms & Conditions/i));
    expect(openLinkSpy).toHaveBeenCalledWith("https://example.com/terms");

    fireEvent.click(screen.getByText(/Privacy Policy/i));
    expect(openLinkSpy).toHaveBeenCalledWith("https://example.com/privacy");
  });

  it("prefills the email remembered from last time", () => {
    localStorage.setItem("rememberedEmail", "back@example.com");
    render(<LoginDialog isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByLabelText("Email")).toHaveValue("back@example.com");
  });

  it("close icon and Escape both trigger onClose callback", () => {
    const onClose = vi.fn();
    render(<LoginDialog isOpen onClose={onClose} onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByTestId("close"));
    expect(onClose).toHaveBeenCalled();

    // Carbon ComposedModal closes on Escape.
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
