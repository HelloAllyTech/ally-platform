import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

/**
 * TF1 (25 Nov): Who may chat showed "Invite only" on pages that were public, with no public choice
 * anywhere. Public is shown now, off for now; a page that is public already shows it selected.
 */
const h = vi.hoisted(() => ({ save: vi.fn(), update: vi.fn() }));

vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetAccessListQuery: () => ({ data: [], isError: false }),
  useAddAccessEntriesMutation: () => [vi.fn(), { isLoading: false }],
  useRemoveAccessEntryMutation: () => [vi.fn()],
  useUpdateChatbotMutation: () => [h.update],
  useSaveHomeFieldMutation: () => [
    (args: unknown) => ({ unwrap: () => Promise.resolve(h.save(args) ?? {}) }),
  ],
  chatbotsApi: { util: { updateQueryData: vi.fn(() => ({ type: "patched" })) } },
}));
vi.mock("react-redux", () => ({ useDispatch: () => vi.fn() }));

/* eslint-disable import/first */
import { TF1_COPY } from "../copy/tf1";
import { WhoMayChat } from "../sections/WhoMayChat";
/* eslint-enable import/first */

const props = (pageAccess: string) =>
  ({
    bot: { id: "b1", accessMode: "listed" },
    home: { fields: { pageAccess: { value: pageAccess, version: "v1" } } },
    canEdit: true,
    canManage: true,
    go: vi.fn(),
  }) as never;

describe("Who may chat: the public choice", () => {
  it("shows Public, switched off, beside Invite only", () => {
    render(<WhoMayChat {...props("invite")} />);
    const pub = screen.getByRole("radio", { name: TF1_COPY.access.publicChoiceLabel });
    expect(pub).toBeDisabled();
    expect(pub).not.toBeChecked();
    expect(screen.getByLabelText(/Invite only/)).toBeChecked();
  });

  it("a public page shows the truth, and Invite only switches it", () => {
    render(<WhoMayChat {...props("public")} />);
    expect(screen.getByRole("radio", { name: TF1_COPY.access.publicChoiceLabel })).toBeChecked();
    expect(screen.getByLabelText(/Invite only/)).not.toBeChecked();
    expect(screen.getByTestId("who-can-chat-line").textContent).toBe(TF1_COPY.access.public);
    expect(screen.getByTestId("access-empty").textContent).toBe(TF1_COPY.access.emptyWhilePublic);
    fireEvent.click(screen.getByLabelText(/Invite only/));
    expect(screen.getByLabelText(/Invite only/)).toBeChecked();
  });
});
