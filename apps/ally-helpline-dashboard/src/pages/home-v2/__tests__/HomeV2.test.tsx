import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ANALYTICS_EVENTS } from "@constants/analyticsEvents";

import { HomeV2 } from "../HomeV2";

const mocks = vi.hoisted(() => ({
  generateOTP: vi.fn(),
  verifyOTP: vi.fn(),
  googleSignIn: vi.fn(),
  putTerms: vi.fn(),
  track: vi.fn(),
  navigate: vi.fn(),
  checkAuth: vi.fn(),
  isAuthenticated: false,
}));

vi.mock("@api", () => ({
  useGenerateOTPMutation: () => [mocks.generateOTP, { isLoading: false }],
  useVerifyOTPMutation: () => [mocks.verifyOTP, { isLoading: false }],
  useGoogleSignInMutation: () => [mocks.googleSignIn],
  usePutTermsAndAgreementMutation: () => [mocks.putTerms],
  useGetPublicBlogsQuery: () => ({
    data: {
      blogs: [
        { title: "Older post", slug: "older", createdAt: "2026-09-01T00:00:00Z" },
        { title: "Newest post", slug: "newest", createdAt: "2026-10-10T00:00:00Z" },
      ],
    },
  }),
}));

vi.mock("@react-oauth/google", () => ({
  GoogleLogin: () => null,
  GoogleOAuthProvider: ({ children }: any) => children,
  useGoogleLogin:
    ({ onSuccess }: any) =>
    () =>
      onSuccess({ access_token: "google-token" }),
}));

vi.mock("@hooks", () => ({
  useUser: () => ({ isAuthenticated: mocks.isAuthenticated, checkAuth: mocks.checkAuth }),
  useAnalytics: () => ({ track: mocks.track }),
}));

vi.mock("@assets", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Ally: () => <span>Ally</span>,
}));

vi.mock("@components", () => ({
  // A single box standing in for the four digit boxes; completes at four digits.
  OTP: ({ value, onChange, onComplete }: any) => (
    <input
      aria-label="code"
      value={value}
      onChange={event => {
        onChange(event.target.value);
        if (event.target.value.length === 4) onComplete?.(event.target.value);
      }}
    />
  ),
  TermsAndAgreement: ({ isOpen, handleAgreeButtonClick }: any) =>
    isOpen ? <button onClick={handleAgreeButtonClick}>Agree to terms</button> : null,
}));

vi.mock("../../../components/language-selector/LanguageSelector", () => ({
  default: () => <span>Language</span>,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mocks.navigate };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));

const resolves = (value: unknown) => ({ unwrap: () => Promise.resolve(value) });
const rejects = (error: unknown) => ({ unwrap: () => Promise.reject(error) });

const renderPage = (user: { name: string } | null = null) => {
  const store = configureStore({
    reducer: { user: (state = { user, isAuthenticated: !!user }) => state },
  });
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/v2"]}>
        <HomeV2 />
      </MemoryRouter>
    </Provider>,
  );
};

const type = (text: string) => {
  fireEvent.change(screen.getByLabelText("Ask Ally anything, or type your email to sign in"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
};

const trackedCalls = () => JSON.stringify(mocks.track.mock.calls);

describe("HomeV2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthenticated = false;
    localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("greets the visitor, says what it can do, and offers suggestions", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Hi, I'm Ally." })).toBeInTheDocument();
    expect(screen.getByText(/type your email below to sign in/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try a practice moment" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I need support myself" })).toBeInTheDocument();
  });

  it("answers a suggestion with reviewed copy, logs only the topic, and stops offering it", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Is it private?" }));

    // Assist and practice are answered separately: practice audio IS stored.
    expect(screen.getByText("Audio recordings are not stored.")).toBeInTheDocument();
    expect(screen.getByText(/Roleplay audio and transcripts are stored/)).toBeInTheDocument();
    expect(mocks.track).toHaveBeenCalledWith(ANALYTICS_EVENTS.HOME_V2_SUGGESTION_TAPPED, {
      topic: "privacy",
    });
    expect(screen.queryByRole("button", { name: "Is it private?" })).not.toBeInTheDocument();
  });

  it("runs a practice moment and names the skill the visitor just used", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Try a practice moment" }));

    // Suggestions step aside while a choice is waiting.
    expect(screen.queryByRole("button", { name: "What is Ally?" })).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "It sounds like it isn't only the exam — it's what failing would mean at home.",
      }),
    );

    expect(screen.getByText("Skill: reflecting feelings")).toBeInTheDocument();
    expect(mocks.track).toHaveBeenCalledWith(ANALYTICS_EVENTS.HOME_V2_PRACTICE_RESPONSE_CHOSEN, {
      practice_choice: "b",
    });
    expect(screen.getByRole("button", { name: "Try another response" })).toBeInTheDocument();
  });

  it("shows the latest blog post when asked what's new", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "What's new?" }));

    expect(screen.getByRole("link", { name: /Newest post/ })).toHaveAttribute(
      "href",
      "/blog/newest",
    );
  });

  it("answers an email with no account exactly as it answers a real one", async () => {
    mocks.generateOTP.mockReturnValue(
      rejects({ status: 404, data: { message: "No account found associated with this email" } }),
    );
    renderPage();
    type("  Priya@NGO.org ");

    await waitFor(() =>
      expect(
        screen.getByText(
          "If priya@ngo.org has an Ally account, a 4-digit code is on its way. It's valid for 5 minutes.",
        ),
      ).toBeInTheDocument(),
    );
    expect(mocks.generateOTP).toHaveBeenCalledWith({ email: "priya@ngo.org" });
    expect(screen.getByText("4-digit code sent to priya@ngo.org")).toBeInTheDocument();
    expect(screen.queryByText(/No account found/)).not.toBeInTheDocument();
  });

  it("says so when the email could not be sent, instead of pretending a code is coming", async () => {
    mocks.generateOTP.mockReturnValue(rejects({ status: 503 }));
    renderPage();
    type("priya@ngo.org");

    await waitFor(() =>
      expect(screen.getByText(/I couldn't send the email just now/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/4-digit code sent to/)).not.toBeInTheDocument();
  });

  it("signs in with a code: terms first, then tokens stored, email remembered, app opened", async () => {
    mocks.generateOTP.mockReturnValue(resolves({ success: true, expiresIn: 600 }));
    mocks.verifyOTP.mockReturnValue(resolves({ accessToken: "access", refreshToken: "refresh" }));
    mocks.putTerms.mockResolvedValue({ data: { success: true } });
    renderPage();
    type("priya@ngo.org");

    await waitFor(() => expect(screen.getByText(/valid for 10 minutes/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("code"), { target: { value: "4821" } });

    const agree = await screen.findByRole("button", { name: "Agree to terms" });
    expect(mocks.verifyOTP).toHaveBeenCalledWith({ email: "priya@ngo.org", otp: "4821" });
    // Nothing is stored until the terms are accepted.
    expect(localStorage.getItem("accessToken")).toBeNull();

    fireEvent.click(agree);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/"));
    expect(localStorage.getItem("accessToken")).toBe("access");
    expect(localStorage.getItem("refreshToken")).toBe("refresh");
    expect(localStorage.getItem("rememberedEmail")).toBe("priya@ngo.org");
  });

  it("says a wrong code didn't match and lets the visitor try again", async () => {
    mocks.generateOTP.mockReturnValue(resolves({ success: true, expiresIn: 300 }));
    mocks.verifyOTP.mockReturnValue(rejects({ status: 401, data: { message: "Invalid OTP" } }));
    renderPage();
    type("priya@ngo.org");

    await screen.findByText("4-digit code sent to priya@ngo.org");
    fireEvent.change(screen.getByLabelText("code"), { target: { value: "0000" } });

    await waitFor(() =>
      expect(screen.getByText(/That code didn't match, or it has expired/)).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("code")).toHaveValue("");
  });

  it("meets distress with Tele-MANAS and never logs what was typed", () => {
    renderPage();
    type("honestly i'm not okay these days");

    expect(screen.getByText("Thank you for telling me. I'm glad you said something.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Call 14416" })).toHaveAttribute("href", "tel:14416");
    expect(mocks.track).toHaveBeenCalledWith(ANALYTICS_EVENTS.HOME_V2_SUPPORT_SHOWN, {
      source: "typed",
    });
    expect(trackedCalls()).not.toContain("not okay");
  });

  it("puts support one tap away in the header", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Need support now?" }));

    expect(screen.getByRole("link", { name: "Call 14416" })).toBeInTheDocument();
    expect(mocks.track).toHaveBeenCalledWith(ANALYTICS_EVENTS.HOME_V2_SUPPORT_SHOWN, {
      source: "header",
    });
  });

  it("logs an unanswered question with its personal details scrubbed out", () => {
    renderPage();
    type("Does Ally work offline? mail me at priya@ngo.org");

    expect(screen.getByText(/I don't have a good answer to that yet/)).toBeInTheDocument();
    expect(mocks.track).toHaveBeenCalledWith(ANALYTICS_EVENTS.HOME_V2_QUESTION_ASKED, {
      topic: "fallback",
      matched: false,
      question_text: "Does Ally work offline? mail me at [email]",
      query_length: 48,
    });
    expect(trackedCalls()).not.toContain("priya@ngo.org");
  });

  it("logs a matched question by topic only", () => {
    renderPage();
    type("Is my data safe?");

    expect(mocks.track).toHaveBeenCalledWith(ANALYTICS_EVENTS.HOME_V2_QUESTION_ASKED, {
      topic: "privacy",
      matched: true,
    });
  });

  it("offers a remembered device one-tap sign-in, and forgets it on 'Not you?'", async () => {
    localStorage.setItem("rememberedEmail", "priya@ngo.org");
    mocks.generateOTP.mockReturnValue(resolves({ success: true, expiresIn: 300 }));
    renderPage();

    expect(screen.getByRole("heading", { name: "Welcome back." })).toBeInTheDocument();
    expect(screen.getByText("p••••@ngo.org")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Not you?" }));
    expect(localStorage.getItem("rememberedEmail")).toBeNull();
    expect(screen.getByText("No problem. Type your email below.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hi, I'm Ally." })).toBeInTheDocument();
  });

  it("sends the remembered address a code without showing it in full", async () => {
    localStorage.setItem("rememberedEmail", "priya@ngo.org");
    mocks.generateOTP.mockReturnValue(resolves({ success: true, expiresIn: 300 }));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Send my code" }));

    await screen.findByText("4-digit code sent to p••••@ngo.org");
    expect(mocks.generateOTP).toHaveBeenCalledWith({ email: "priya@ngo.org" });
  });

  it("greets a signed-in visitor by name and offers the way into the app", () => {
    mocks.isAuthenticated = true;
    renderPage({ name: "Priya Sharma" });

    expect(screen.getByRole("heading", { name: "Welcome back, Priya." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Ally" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });
});
