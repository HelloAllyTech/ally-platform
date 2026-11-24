import React from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The invite page (`/assistant-invite?token=`): it shows what the invite is for, then accepts as
 * the signed-in account, or with the invited email typed in followed by signing in with it.
 */
const preview = vi.fn();
const acceptSignedIn = vi.fn();
const acceptPublic = vi.fn();
vi.mock("@api", () => ({
  usePreviewAssistantInviteMutation: () => [preview, { isLoading: false }],
  useAcceptAssistantInviteMutation: () => [acceptSignedIn, { isLoading: false }],
  useAcceptAssistantInvitePublicMutation: () => [acceptPublic, { isLoading: false }],
}));

// `@constants` reaches the store through the hooks and utils barrels; the page needs none of it.
vi.mock("../../../store", () => ({ store: { getState: () => ({}), dispatch: vi.fn() } }));

const { AssistantInvite } = await import("../../AssistantInvite");

const ok = (value: unknown) => ({ unwrap: () => Promise.resolve(value) });
const refused = (status: number, errorCode: string) => ({
  unwrap: () => Promise.reject({ status, data: { errorCode, message: "x" } }),
});
const accepted = {
  chatbotId: "bot-9",
  chatbotName: "Sunrise",
  roles: ["responder"],
  accountCreated: false,
  email: "meera@clinic.test",
};

const Where: React.FC = () => {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
};

const open = async (url = "/assistant-invite?token=tok") => {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/assistant-invite" element={<AssistantInvite />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {});
};

beforeEach(() => {
  [preview, acceptSignedIn, acceptPublic].forEach(fn => fn.mockReset());
  localStorage.clear();
  preview.mockReturnValue(
    ok({
      chatbotName: "Sunrise",
      email: "m***@clinic.test",
      roles: ["viewer", "responder"],
      expiresAt: "2030-01-01T00:00:00Z",
    }),
  );
});

describe("the invite page", () => {
  it("shows the chatbot and the roles, from the token", async () => {
    await open();
    expect(preview).toHaveBeenCalledWith({ token: "tok" });
    expect(
      screen.getByText("You've been invited to Sunrise as Responder, Viewer."),
    ).toBeInTheDocument();
    expect(screen.getByText("Sent to m***@clinic.test.")).toBeInTheDocument();
  });

  it("says so when the invite is gone or the link has no token", async () => {
    preview.mockReturnValue(refused(404, "invite_not_found"));
    await open();
    expect(screen.getByText(/expired or was withdrawn/)).toBeInTheDocument();
  });

  it("explains a link with no token", async () => {
    await open("/assistant-invite");
    expect(preview).not.toHaveBeenCalled();
    expect(screen.getByText(/link is incomplete/)).toBeInTheDocument();
  });

  it("accepts as the signed-in account and opens the chatbot", async () => {
    localStorage.setItem("adminIsAuthenticated", "true");
    acceptSignedIn.mockReturnValue(ok(accepted));
    await open();
    expect(screen.queryByLabelText("Your email address")).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Accept invite" })));
    expect(acceptSignedIn).toHaveBeenCalledWith({ token: "tok" });
    expect(acceptPublic).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open Sunrise" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/assistants/bot-9");
  });

  it("offers the email field when the signed-in account has another address", async () => {
    localStorage.setItem("adminIsAuthenticated", "true");
    acceptSignedIn.mockReturnValue(refused(403, "invite_wrong_email"));
    await open();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Accept invite" })));
    expect(screen.getByRole("alert")).toHaveTextContent("sent to a different email address");
    expect(screen.getByLabelText("Your email address")).toBeInTheDocument();
  });

  it("signed out: takes the invited email, then sends them to sign in with it", async () => {
    acceptPublic.mockReturnValue(ok(accepted));
    await open();
    fireEvent.change(screen.getByLabelText("Your email address"), {
      target: { value: "meera@clinic.test" },
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Accept invite" })));
    expect(acceptPublic).toHaveBeenCalledWith({ token: "tok", email: "meera@clinic.test" });
    expect(screen.getByText(/sign in with meera@clinic.test/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/login?next=%2Fassistants%2Fbot-9");
  });

  it("refuses a wrong email in plain words", async () => {
    acceptPublic.mockReturnValue(refused(403, "invite_wrong_email"));
    await open();
    fireEvent.change(screen.getByLabelText("Your email address"), {
      target: { value: "other@clinic.test" },
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Accept invite" })));
    expect(screen.getByRole("alert")).toHaveTextContent("different email address");
  });
});
