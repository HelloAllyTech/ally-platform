import React from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgreementGateContext, useAgreementGate } from "../agreement/context";
import { needsAgreement } from "../teamErrors";

/**
 * The responder agreement: a Responder sees it instead of the chats until the current version is
 * accepted; accepting posts that version; a refused take-over opens it as a dialog.
 */
let status: unknown;
const accept = vi.fn();
vi.mock("@api", () => ({
  useGetResponderAgreementQuery: () => ({
    data: status,
    isLoading: false,
    isError: !status,
    refetch: vi.fn(),
  }),
  useAcceptResponderAgreementMutation: () => [accept, { isLoading: false }],
}));
vi.mock("../sections/AccessLists", () => ({ LoadFailed: () => <p>failed</p> }));

const { ResponderAgreementGate, ResponderAgreementDialog } =
  await import("../agreement/ResponderAgreement");

const agreement = (over: object = {}) => ({
  currentVersion: "v1",
  text: "PLACEHOLDER agreement text",
  accepted: false,
  acceptedVersion: null,
  acceptedAt: null,
  enforced: true,
  ...over,
});

beforeEach(() => {
  accept.mockReset();
  status = agreement();
});

describe("the agreement gate", () => {
  it("shows the agreement instead of the chats for a Responder who hasn't accepted", () => {
    render(
      <ResponderAgreementGate required>
        <p>the chats</p>
      </ResponderAgreementGate>,
    );
    expect(screen.queryByText("the chats")).toBeNull();
    expect(screen.getByText("PLACEHOLDER agreement text")).toBeInTheDocument();
  });

  it("posts the version on screen when they accept", async () => {
    accept.mockReturnValue({ unwrap: () => Promise.resolve(agreement({ accepted: true })) });
    render(
      <ResponderAgreementGate required>
        <p>the chats</p>
      </ResponderAgreementGate>,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "I agree" })));
    expect(accept).toHaveBeenCalledWith({ version: "v1" });
  });

  it("asks again with the new version when the old one is stale", async () => {
    accept.mockReturnValue({
      unwrap: () => Promise.reject({ status: 409, data: { errorCode: "stale_version" } }),
    });
    render(
      <ResponderAgreementGate required>
        <p>the chats</p>
      </ResponderAgreementGate>,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "I agree" })));
    expect(screen.getByRole("alert")).toHaveTextContent("The agreement changed");
  });

  it("lets the chats through once accepted, when not enforced, or for other roles", () => {
    status = agreement({ accepted: true });
    const { rerender } = render(
      <ResponderAgreementGate required>
        <p>the chats</p>
      </ResponderAgreementGate>,
    );
    expect(screen.getByText("the chats")).toBeInTheDocument();
    status = agreement({ enforced: false });
    rerender(
      <ResponderAgreementGate required>
        <p>the chats</p>
      </ResponderAgreementGate>,
    );
    expect(screen.getByText("the chats")).toBeInTheDocument();
    status = agreement();
    rerender(
      <ResponderAgreementGate required={false}>
        <p>the chats</p>
      </ResponderAgreementGate>,
    );
    expect(screen.getByText("the chats")).toBeInTheDocument();
  });
});

describe("a refused take-over", () => {
  it("is recognised by its error code and asks the section for the agreement", () => {
    expect(
      needsAgreement({ status: 403, data: { errorCode: "responder_agreement_required" } }),
    ).toBe(true);
    expect(needsAgreement({ status: 403, data: { errorCode: "other" } })).toBe(false);
    const require = vi.fn();
    const Caller: React.FC = () => {
      const gate = useAgreementGate();
      return <button onClick={gate.require}>go</button>;
    };
    render(
      <AgreementGateContext.Provider value={{ require }}>
        <Caller />
      </AgreementGateContext.Provider>,
    );
    fireEvent.click(screen.getByText("go"));
    expect(require).toHaveBeenCalled();
  });

  it("shows as a dialog and closes after accepting", async () => {
    accept.mockReturnValue({ unwrap: () => Promise.resolve(agreement({ accepted: true })) });
    const onClose = vi.fn();
    render(<ResponderAgreementDialog onClose={onClose} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "I agree" })));
    expect(onClose).toHaveBeenCalled();
  });
});
