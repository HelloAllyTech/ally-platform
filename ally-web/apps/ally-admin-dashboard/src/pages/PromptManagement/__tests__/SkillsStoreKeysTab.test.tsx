import React from "react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockToastError, mockToastSuccess } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: mockToastError, success: mockToastSuccess } }));

let mockKeys: any[] = [];
const mockCreateKey = vi.fn();
const mockRevokeKey = vi.fn();
vi.mock("@api", () => ({
  useGetSkillsStoreKeysQuery: () => ({ data: mockKeys, isLoading: false }),
  useCreateSkillsStoreKeyMutation: () => [mockCreateKey, { isLoading: false }],
  useRevokeSkillsStoreKeyMutation: () => [mockRevokeKey],
}));
vi.mock("@assets", () => ({ Copy: () => <span data-testid="icon-copy" /> }));
// Only the copy is needed; the constants barrel pulls in components this suite mocks.
vi.mock("@constants", async () => ({
  en: (await vi.importActual<any>("../../../constants/en")).en,
}));
vi.mock("@components", () => ({
  ActionConfirmationPopup: ({ isOpen, title, primaryButton, secondaryButton }: any) =>
    isOpen ? (
      <div data-testid="confirmation-popup">
        <h2>{title}</h2>
        <button onClick={primaryButton.onClick}>{`confirm ${primaryButton.label}`}</button>
        <button onClick={secondaryButton.onClick}>{secondaryButton.label}</button>
      </div>
    ) : null,
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

import { SkillsStoreKeysTab } from "../SkillsStoreKeysTab";

const resolved = (value: unknown) => ({ unwrap: () => Promise.resolve(value) });

describe("SkillsStoreKeysTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKeys = [];
  });

  it("generates a key with the chosen scopes and shows it once, then never again", async () => {
    mockCreateKey.mockReturnValue(
      resolved({
        id: "k1",
        name: "Asha (contract)",
        scopes: ["pull", "push"],
        key: "ssk_secret123",
      }),
    );
    render(<SkillsStoreKeysTab />);

    fireEvent.change(screen.getByPlaceholderText("Who or what is this key for?"), {
      target: { value: "Asha (contract)" },
    });
    fireEvent.click(screen.getByLabelText("Push (save draft versions)"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Generate key" }));
    });

    expect(mockCreateKey).toHaveBeenCalledWith({
      name: "Asha (contract)",
      scopes: ["pull", "push"],
    });
    expect(screen.getByTestId("skills-store-new-key")).toHaveTextContent("ssk_secret123");
    expect(
      screen.getByText("You won't see it again. Only a fingerprint of it is stored."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("ssk_secret123")).not.toBeInTheDocument();
  });

  it("will not generate a key without a name or a scope", () => {
    render(<SkillsStoreKeysTab />);
    expect(screen.getByRole("button", { name: "Generate key" })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("Who or what is this key for?"), {
      target: { value: "CI" },
    });
    fireEvent.click(screen.getByLabelText("Pull (read live and draft prompts)"));
    expect(screen.getByRole("button", { name: "Generate key" })).toBeDisabled();
  });

  it("lists keys by their first characters and revokes one after a confirm", async () => {
    mockKeys = [
      {
        id: "k1",
        name: "Local laptop",
        prefix: "ssk_AbCdEfGh",
        scopes: ["pull"],
        createdBy: 1,
        createdAt: "2026-10-20T10:00:00Z",
        revokedAt: null,
        lastUsedAt: null,
      },
      {
        id: "k2",
        name: "Old contractor",
        prefix: "ssk_ZyXwVuTs",
        scopes: ["pull", "push"],
        createdBy: 1,
        createdAt: "2026-09-01T10:00:00Z",
        revokedAt: "2026-10-01T10:00:00Z",
        lastUsedAt: "2026-09-30T10:00:00Z",
      },
    ];
    mockRevokeKey.mockReturnValue(resolved({ ok: true }));
    render(<SkillsStoreKeysTab />);

    expect(screen.getByTestId("skills-store-key-k1")).toHaveTextContent("ssk_AbCdEfGh…");
    expect(screen.getByTestId("skills-store-key-k1")).toHaveTextContent("Last used Never");
    // A revoked key cannot be revoked again.
    expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(screen.getByText('Revoke "Local laptop"?')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "confirm Revoke" }));
    });
    expect(mockRevokeKey).toHaveBeenCalledWith("k1");
  });
});
