import { configureStore } from "@reduxjs/toolkit";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { Login } from "../Login";

// Mock react-router-dom hooks
const mockNavigate = vi.fn();

vi.mock("@react-oauth/google", () => ({
  GoogleLogin: ({ onSuccess, onError }: any) => (
    <button data-testid="google-login" onClick={() => onSuccess({ credential: "mock-credential" })}>
      Continue with Google
    </button>
  ),
  GoogleOAuthProvider: ({ children }: any) => <div>{children}</div>,
  useGoogleLogin: ({ onSuccess, onError }: any) => {
    return () => {
      onSuccess({ access_token: "mock-access-token" });
    };
  },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Mock API hooks
const mockGenerateOTP = vi.fn();
const mockVerifyOTP = vi.fn();

const mockUseGenerateOTPMutation = vi.fn(() => [
  mockGenerateOTP,
  {
    isLoading: false,
    isSuccess: false,
    data: null,
    error: null,
  },
]);

const mockUseVerifyOTPMutation = vi.fn(() => [
  mockVerifyOTP,
  {
    isLoading: false,
    isSuccess: false,
    data: null,
    error: null,
  },
]);
const mockGoogleSignInMutation = vi.fn(() => [
  mockGoogleSignInMutation,
  {
    data: null,
    error: null,
  },
]);
vi.mock("@api", () => ({
  // evaluatorAPI is wired into the store alongside baseAPI; stub it too so
  // store init (reducerPath/reducer/middleware) does not throw.
  evaluatorAPI: {
    reducerPath: "evaluatorAPI",
    reducer: (state = {}) => state,
    middleware: () => (next: any) => (action: any) => next(action),
    util: { resetApiState: () => ({ type: "reset" }) },
  },
  useGenerateOTPMutation: () => mockUseGenerateOTPMutation(),
  useVerifyOTPMutation: () => mockUseVerifyOTPMutation(),
  useGoogleSignInMutation: () => mockGoogleSignInMutation(),
  useGetTermsQuery: () => ({ data: { html: "<p>Terms body</p>" }, isFetching: false }),
  useGetPrivacyQuery: () => ({ data: { html: "<p>Privacy body</p>" }, isFetching: false }),
  baseAPI: {
    injectEndpoints: vi.fn(() => ({})),
    reducerPath: "baseAPI",
    reducer: (state = {}) => state,
    middleware: () => (next: any) => (action: any) => next(action),
    util: {
      resetApiState: vi.fn(),
    },
  },
}));

// Mock useUser hook
const mockCheckAuth = vi.fn();

const mockUseUser = vi.fn(() => ({
  isAuthenticated: false,
  checkAuth: mockCheckAuth,
}));

vi.mock("@hooks/useUser", () => ({
  useUser: () => mockUseUser(),
}));

vi.mock("@components", () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
  OTP: ({ value, onChange }: any) => (
    <input
      data-testid="otp-input"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="Enter OTP"
    />
  ),
  TextField: ({ value, onChange, errorMessage, label, placeholder }: any) => (
    <div>
      <label>{label}</label>
      <input
        data-testid="text-field-input"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />
      {errorMessage && <span data-testid="field-error">{errorMessage}</span>}
    </div>
  ),
}));

// Mock assets
vi.mock("@assets", () => ({
  ArrowDown: () => <div data-testid="arrow-down">Arrow</div>,
  BackCircle: ({ onClick, className }: any) => (
    <div data-testid="back-circle" onClick={onClick} className={className}>
      Back
    </div>
  ),
  LoginImage: "login-image.jpg",
}));

// Mock constants
vi.mock("@constants", () => ({
  LoginSection: {
    EMAIL: "EMAIL",
    OTP: "OTP",
  },
  TAG_TYPES: {
    USERS: "users",
    TENANTS: "tenants",
    SESSION_EVENTS: "sessionEvents",
    SESSION_EVENT_TAGS: "sessionEventTags",
    SIMULATION: "simulation",
    SIMULATION_EVENTS: "simulationEvents",
    SIMULATION_PATHS: "simulationPaths",
    SCENARIO_PATHS: "scenarioPaths",
    EACH_SESSION: "eachSession",
    SIMULATION_CASES: "simulationCases",
    TRIGGER_WARNINGS: "triggerWarnings",
    SCENARIO_VOICES: "scenarioVoices",
    SCENARIO_LANGUAGES: "scenarioLanguages",
    SUMMARY_SECTIONS: "summarySections",
    UPDATE_SUMMARY_SECTIONS: "updateSummarySections",
    CHARACTERS: "characters",
    PROMPTS: "prompts",
    CONVERSATIONAL_GUARDRAILS: "conversationalGuardrails",
    USER_BADGES: "userBadges",
    HELPER_TAGS: "helperTags",
  },
  LOCAL_STORAGE_KEYS: {
    ADMIN_ACCESS_TOKEN: "adminAccessToken",
    ADMIN_REFRESH_TOKEN: "adminRefreshToken",
    ADMIN_IS_AUTHENTICATED: "adminIsAuthenticated",
  },
  ALLY_TERMS_URL: "https://ally.com/terms",
  ALLY_PRIVACY_POLICY_URL: "https://ally.com/privacy",
  ALLY_URL: "https://ally.com",
  ROUTES: { WHATSAPP_BOT: "/assistants" },
  en: {
    assistantsShell: {
      login: {
        headline: "Build and manage your own custom ",
        headlineEmphasis: "chatbots.",
        sendCode: "Send code",
        googleSignIn: "Sign in using Google",
        wordmarkName: "Ally",
        wordmarkProduct: "chatbots",
        useCases: [],
        capabilities: { heading: "", items: [] },
      },
    },
    common: {
      or: "OR",
    },
    auth: {
      hey: "Hey",
      welcomeTo: "Welcome to",
      ally: "ally",
      email: "Email",
      rememberMe: "Remember me",
      generatingOTP: "Generating OTP...",
      signingIn: "Signing in...",
      termsAndConditions: "Terms and Conditions",
      privacyPolicy: "Privacy Policy",
      didNotReceiveTheCode: "Didn't receive the code?",
      enterEmailToContinue: "Enter your email address to continue",
      enterEmailPlaceholder: "Enter your email address",
      next: "Next",
      byTappingNext: "By tapping next, you agree to Ally's",
      andAcknowledge: "and acknowledge",
      verifyYourEmail: "Verify your email address",
      enterSecurityCode: "Enter the security code sent to",
      codeWillExpire: "This code will expire in",
      minutes: "minutes",
      needNewCode: "Need a new code?",
      resend: "Resend",
      verify: "Verify",
      helloAllyUrl: "helloally.ai",
      failedToGenerateOTP: "Failed to generate OTP. Please try again.",
      failedToVerifyOTP: "Failed to verify OTP. Please try again.",
      invalidEmailError: "Please enter a valid email address",
    },
  },
}));

// Mock utils
vi.mock("@utils", async () => ({
  ...(await vi.importActual<typeof import("../../../utils/loginRedirect")>(
    "../../../utils/loginRedirect",
  )),
  validateEmail: (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  },
  openLinkInNewTab: vi.fn(),
}));

// Mock framer-motion to eliminate animation timing issues
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

// Mock @ally-ui-mono/ui-shared
vi.mock("@ally-ui-mono/ui-shared", () => ({
  CustomImage: ({ src, alt, ...props }: any) => (
    <img data-testid="custom-image" src={src} alt={alt} {...props} />
  ),
  GoogleSignInButton: ({ onSuccess, onError, text = "Continue with Google" }: any) => (
    <button
      data-testid="google-sign-in-button"
      onClick={() => onSuccess({ accessToken: "mock-token" })}
    >
      {text}
    </button>
  ),
}));

describe("Login", () => {
  let store: any;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Create a mock store
    store = configureStore({
      reducer: {
        user: () => ({
          user: null,
        }),
      },
    });
  });

  const renderLogin = () => {
    return render(
      <Provider store={store}>
        <BrowserRouter>
          <Login />
        </BrowserRouter>
      </Provider>,
    );
  };

  describe("Email Section Rendering", () => {
    it("should render login page with email section", () => {
      renderLogin();

      expect(screen.getByText("Hey,")).toBeInTheDocument();
      expect(screen.getByText(/Welcome to/)).toBeInTheDocument();
      expect(screen.getByTestId("text-field-input")).toBeInTheDocument();
    });

    it("should render email input field", () => {
      renderLogin();

      const emailInput = screen.getByTestId("text-field-input");
      expect(emailInput).toBeInTheDocument();
      expect(emailInput).toHaveAttribute("placeholder", "Enter your email address");
    });

    it("should render remember me checkbox", () => {
      renderLogin();

      expect(screen.getByText("Remember me")).toBeInTheDocument();
      expect(screen.getByRole("checkbox")).toBeInTheDocument();
    });

    it("should render next button", () => {
      renderLogin();

      expect(screen.getByText("Next")).toBeInTheDocument();
    });

    it("should render terms and privacy policy links", () => {
      renderLogin();

      expect(screen.getByText("Terms and Conditions")).toBeInTheDocument();
      expect(screen.getByText("Privacy Policy.")).toBeInTheDocument();
    });

    it("should render login image", () => {
      renderLogin();

      expect(screen.getByTestId("custom-image")).toBeInTheDocument();
    });
  });

  describe("Email Input", () => {
    it("should update email value when typing", () => {
      renderLogin();

      const emailInput = screen.getByTestId("text-field-input");
      fireEvent.change(emailInput, { target: { value: "test@example.com" } });

      expect(emailInput).toHaveValue("test@example.com");
    });

    it("should convert email to lowercase", () => {
      renderLogin();

      const emailInput = screen.getByTestId("text-field-input");
      fireEvent.change(emailInput, { target: { value: "TEST@EXAMPLE.COM" } });

      expect(emailInput).toHaveValue("test@example.com");
    });

    it("should clear error message when typing", () => {
      renderLogin();

      const emailInput = screen.getByTestId("text-field-input");
      const nextButton = screen.getByText("Next");

      // Trigger error by clicking next with invalid email
      fireEvent.click(nextButton);

      // Type to clear error
      fireEvent.change(emailInput, { target: { value: "test@example.com" } });

      expect(screen.queryByTestId("field-error")).not.toBeInTheDocument();
    });
  });

  describe("Email Validation", () => {
    it("should show error for invalid email", () => {
      renderLogin();

      const emailInput = screen.getByTestId("text-field-input");
      const nextButton = screen.getByText("Next");

      fireEvent.change(emailInput, { target: { value: "invalid-email" } });
      fireEvent.click(nextButton);

      expect(screen.getByTestId("field-error")).toHaveTextContent(
        "Please enter a valid email address",
      );
    });

    it("should not show error for valid email", () => {
      renderLogin();

      const emailInput = screen.getByTestId("text-field-input");
      const nextButton = screen.getByText("Next");

      fireEvent.change(emailInput, { target: { value: "test@example.com" } });
      fireEvent.click(nextButton);

      expect(screen.queryByTestId("field-error")).not.toBeInTheDocument();
    });

    it("should disable next button when email is empty", () => {
      renderLogin();

      const nextButton = screen.getByText("Next");
      expect(nextButton).toBeDisabled();
    });
  });

  describe("Remember Me", () => {
    it("should toggle remember me checkbox", () => {
      renderLogin();

      const checkbox = screen.getByRole("checkbox");
      expect(checkbox).not.toBeChecked();

      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();

      fireEvent.click(checkbox);
      expect(checkbox).not.toBeChecked();
    });

    it("should save email to localStorage when remember me is checked", () => {
      renderLogin();

      const emailInput = screen.getByTestId("text-field-input");
      const checkbox = screen.getByRole("checkbox");
      const nextButton = screen.getByText("Next");

      fireEvent.change(emailInput, { target: { value: "test@example.com" } });
      fireEvent.click(checkbox);
      fireEvent.click(nextButton);

      expect(localStorage.getItem("adminRememberedEmail")).toBe("test@example.com");
    });

    it("should load remembered email on mount", () => {
      localStorage.setItem("adminRememberedEmail", "remembered@example.com");

      renderLogin();

      const emailInput = screen.getByTestId("text-field-input");
      expect(emailInput).toHaveValue("remembered@example.com");
    });
  });

  describe("Generate OTP", () => {
    it("submits the email when Enter is pressed", async () => {
      mockGenerateOTP.mockResolvedValue({ data: { success: true } });
      renderLogin();
      const emailInput = screen.getByTestId("text-field-input");
      fireEvent.change(emailInput, { target: { value: "test@example.com" } });
      fireEvent.keyDown(emailInput, { key: "Enter" });
      await waitFor(() =>
        expect(mockGenerateOTP).toHaveBeenCalledWith({ email: "test@example.com" }),
      );
    });

    it("does not submit on Enter while the email is empty", () => {
      renderLogin();
      fireEvent.keyDown(screen.getByTestId("text-field-input"), { key: "Enter" });
      expect(mockGenerateOTP).not.toHaveBeenCalled();
    });

    it("should call generateOTP when next button is clicked", async () => {
      mockGenerateOTP.mockResolvedValue({ data: { success: true } });

      renderLogin();

      const emailInput = screen.getByTestId("text-field-input");
      const nextButton = screen.getByText("Next");

      fireEvent.change(emailInput, { target: { value: "test@example.com" } });
      fireEvent.click(nextButton);

      await waitFor(
        () => {
          expect(mockGenerateOTP).toHaveBeenCalledWith({ email: "test@example.com" });
        },
        { timeout: 2000 },
      );
    });

    it("should show OTP section after successful OTP generation", async () => {
      mockUseGenerateOTPMutation.mockReturnValue([
        mockGenerateOTP,
        {
          isLoading: false,
          isSuccess: true,
          data: { success: true },
          error: null,
        },
      ]);

      renderLogin();

      await waitFor(
        () => {
          expect(screen.getByText("Verify your email address")).toBeInTheDocument();
        },
        { timeout: 2000 },
      );
    });

    it("should show error message when OTP generation fails", async () => {
      const { toast } = await import("sonner");

      mockUseGenerateOTPMutation.mockReturnValue([
        mockGenerateOTP,
        {
          isLoading: false,
          isSuccess: false,
          data: null,
          error: { data: { message: "Failed to generate OTP" } },
        },
      ]);

      renderLogin();

      await waitFor(
        () => {
          expect(toast.error).toHaveBeenCalledWith("Failed to generate OTP");
        },
        { timeout: 2000 },
      );
    });
  });

  describe("OTP Section", () => {
    beforeEach(() => {
      mockUseGenerateOTPMutation.mockReturnValue([
        mockGenerateOTP,
        {
          isLoading: false,
          isSuccess: true,
          data: { success: true },
          error: null,
        },
      ]);
    });

    it("should render OTP section with all elements", async () => {
      renderLogin();

      // Wait for OTP section to appear after state transition
      const otpHeading = await screen.findByText(
        "Verify your email address",
        {},
        { timeout: 2000 },
      );
      expect(otpHeading).toBeInTheDocument();
      expect(screen.getByTestId("otp-input")).toBeInTheDocument();
      expect(screen.getByTestId("back-circle")).toBeInTheDocument();
      expect(screen.getByText("Verify")).toBeInTheDocument();
    });
  });

  describe("OTP Input", () => {
    beforeEach(() => {
      mockUseGenerateOTPMutation.mockReturnValue([
        mockGenerateOTP,
        {
          isLoading: false,
          isSuccess: true,
          data: { success: true },
          error: null,
        },
      ]);
    });

    it("should handle OTP input and button states", async () => {
      renderLogin();

      // Wait for OTP section to appear
      const otpInput = await screen.findByTestId("otp-input", {}, { timeout: 2000 });
      const verifyButton = screen.getByText("Verify");

      // Initially disabled
      expect(verifyButton).toBeDisabled();

      // Update OTP value
      fireEvent.change(otpInput, { target: { value: "1234" } });
      expect(otpInput).toHaveValue("1234");

      // Should enable after 4+ characters
      expect(verifyButton).not.toBeDisabled();
    });
  });

  describe("Resend OTP", () => {
    beforeEach(() => {
      mockUseGenerateOTPMutation.mockReturnValue([
        mockGenerateOTP,
        {
          isLoading: false,
          isSuccess: true,
          data: { success: true },
          error: null,
        },
      ]);
    });

    it("should show resend link with countdown", async () => {
      renderLogin();

      // Wait for OTP section to appear, then check for resend link
      await screen.findByText("Verify your email address", {}, { timeout: 2000 });
      expect(screen.getByText(/Resend/)).toBeInTheDocument();
    });
  });

  describe("Verify OTP", () => {
    beforeEach(() => {
      mockUseGenerateOTPMutation.mockReturnValue([
        mockGenerateOTP,
        {
          isLoading: false,
          isSuccess: true,
          data: { success: true },
          error: null,
        },
      ]);
    });

    it("should call verifyOTP when verify button is clicked", async () => {
      mockVerifyOTP.mockResolvedValue({ data: { accessToken: "token", refreshToken: "refresh" } });
      mockUseVerifyOTPMutation.mockReturnValue([
        mockVerifyOTP,
        {
          isLoading: false,
          isSuccess: false,
          data: null,
          error: null,
        },
      ]);

      renderLogin();

      // Wait for OTP section to appear
      const otpInput = await screen.findByTestId("otp-input", {}, { timeout: 2000 });
      fireEvent.change(otpInput, { target: { value: "123456" } });

      const verifyButton = screen.getByText("Verify");
      fireEvent.click(verifyButton);

      await waitFor(
        () => {
          expect(mockVerifyOTP).toHaveBeenCalled();
        },
        { timeout: 2000 },
      );
    });
  });

  describe("Loading States", () => {
    it("should show loading state when generating OTP", () => {
      mockUseGenerateOTPMutation.mockReturnValue([
        mockGenerateOTP,
        {
          isLoading: true,
          isSuccess: false,
          data: null,
          error: null,
        },
      ]);

      renderLogin();

      expect(screen.getByText("Generating OTP...")).toBeInTheDocument();
    });
  });

  describe("External Links", () => {
    it("should open terms and conditions link", async () => {
      const { openLinkInNewTab } = await import("@utils");

      renderLogin();

      const termsLink = screen.getByText("Terms and Conditions");
      fireEvent.click(termsLink);

      expect(openLinkInNewTab).toHaveBeenCalledWith("https://ally.com/terms");
    });

    it("should open privacy policy link", async () => {
      const { openLinkInNewTab } = await import("@utils");

      renderLogin();

      const privacyLink = screen.getByText("Privacy Policy.");
      fireEvent.click(privacyLink);

      expect(openLinkInNewTab).toHaveBeenCalledWith("https://ally.com/privacy");
    });
  });

  // A1: no sign-up, and back to the link they opened.
  describe("Login only, then back where they were (A1)", () => {
    it("has no sign-up link or button", () => {
      renderLogin();
      expect(screen.queryByText(/sign\s*up/i)).toBeNull();
      expect(screen.queryByText(/create (an )?account/i)).toBeNull();
    });

    it("goes back to the deep link in ?next once logged in", () => {
      mockUseUser.mockReturnValue({ isAuthenticated: true, checkAuth: mockCheckAuth });
      const loggedIn = configureStore({ reducer: { user: () => ({ user: { id: 1 } }) } });
      render(
        <Provider store={loggedIn}>
          <MemoryRouter
            initialEntries={[
              `/login?next=${encodeURIComponent("/assistants/b1?section=lists&tool=memory")}`,
            ]}
          >
            <Login />
          </MemoryRouter>
        </Provider>,
      );
      expect(mockNavigate).toHaveBeenCalledWith("/assistants/b1?section=lists&tool=memory", {
        replace: true,
      });
    });

    it("ignores a next that leaves the app", () => {
      mockUseUser.mockReturnValue({ isAuthenticated: true, checkAuth: mockCheckAuth });
      const loggedIn = configureStore({ reducer: { user: () => ({ user: { id: 1 } }) } });
      render(
        <Provider store={loggedIn}>
          <MemoryRouter initialEntries={["/login?next=//evil.example"]}>
            <Login />
          </MemoryRouter>
        </Provider>,
      );
      expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
    });
  });

  describe("Assistants login", () => {
    const renderAt = (path: string) =>
      render(
        <Provider store={store}>
          <MemoryRouter initialEntries={[path]}>
            <Login />
          </MemoryRouter>
        </Provider>,
      );

    it.each(["/assistants", "/assistants/b1?section=lists", "/assistants/new"])(
      "shows its own headline and layout at %s",
      path => {
        renderAt(path);
        expect(screen.getByTestId("assistants-login")).toBeInTheDocument();
        expect(screen.getByText("chatbots.")).toBeInTheDocument();
        expect(screen.queryByText("Hey,")).toBeNull();
        // Same sign-in form underneath.
        expect(screen.getByTestId("text-field-input")).toBeInTheDocument();
      },
    );

    it("shows the Ally chatbots wordmark ahead of the headline", () => {
      renderAt("/assistants");
      const wordmark = screen.getByTestId("assistants-login-wordmark");
      expect(wordmark).toHaveTextContent(/Ally\s*chatbots/);
      const headline = screen.getByRole("heading", { level: 1 });
      expect(
        wordmark.compareDocumentPosition(headline) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("has no Remember Me checkbox and remembers the email by default", () => {
      // Earlier tests leave this mock mid-request; this one needs the idle button.
      mockUseGenerateOTPMutation.mockReturnValue([
        mockGenerateOTP,
        { isLoading: false, isSuccess: false, data: undefined, error: undefined },
      ] as any);
      renderAt("/assistants");
      expect(screen.queryByRole("checkbox")).toBeNull();
      fireEvent.change(screen.getByTestId("text-field-input"), {
        target: { value: "a@b.co" },
      });
      fireEvent.click(screen.getByText("Send code"));
      expect(localStorage.getItem("adminRememberedEmail")).toBe("a@b.co");
    });

    it("opens the Terms and the Privacy Policy as side drawers on the same page", () => {
      renderAt("/assistants");
      expect(screen.queryByTestId("legal-drawer")).toBeNull();
      fireEvent.click(screen.getByText("Terms and Conditions"));
      expect(screen.getByRole("dialog", { name: "Terms of Service" })).toBeInTheDocument();
      expect(screen.getByText("Terms body")).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByTestId("legal-drawer")).toBeNull();
      fireEvent.click(screen.getByText("Privacy Policy."));
      expect(screen.getByText("Privacy body")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("legal-drawer-overlay"));
      expect(screen.queryByTestId("legal-drawer")).toBeNull();
    });

    it("keeps the standard login at /login and other pages", () => {
      renderAt("/assistants-x");
      expect(screen.queryByTestId("assistants-login")).toBeNull();
      expect(screen.getByText("Hey,")).toBeInTheDocument();
    });
  });
});
