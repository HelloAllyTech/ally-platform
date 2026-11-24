import React from "react";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Assistants stage 8: the staff search and read-only frame, and the owner's "Ally support"
 * control (grant for conversations, stop, who looked).
 */
let grants: unknown[] = [];
let views: unknown[] = [];
let hits: unknown[] | undefined;
const grant = vi.fn();
const revoke = vi.fn();
const refetch = vi.fn();
const searchArgs: unknown[] = [];

vi.mock("../staffAccessApi", () => ({
  useGetStaffGrantsQuery: () => ({ data: { grants }, refetch }),
  useGetStaffViewsQuery: () => ({ data: { views }, isError: false, isLoading: false }),
  useGrantStaffAccessMutation: () => [grant, { isLoading: false }],
  useRevokeStaffAccessMutation: () => [revoke, { isLoading: false }],
  useSearchStaffChatbotsQuery: (q: string, opts: { skip: boolean }) => {
    searchArgs.push([q, opts.skip]);
    return { data: opts.skip ? undefined : hits, isFetching: false, isError: false };
  },
}));
vi.mock("../../AssistantHome", () => ({
  AssistantHome: () => (
    <div>
      <input aria-label="Name" defaultValue="Sunrise" />
      <textarea aria-label="Instructions" defaultValue="Be kind" />
      <button type="button">Overview</button>
    </div>
  ),
}));

const { StaffAccessPanel, StaffAccess } = await import("../../AssistantHome/sections/StaffAccess");
const { ChatbotSupportSearch } = await import("../ChatbotSupport");
const { ReadOnlyFrame } = await import("../ReadOnlyFrame");
const { STAFF_SUPPORT_COPY } = await import("../copy");

const ok = (value: unknown = {}) => ({ unwrap: () => Promise.resolve(value) });
const BOT = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  grants = [];
  views = [];
  hits = [];
  [grant, revoke, refetch].forEach(fn => fn.mockReset());
  searchArgs.length = 0;
});

describe("Owner: Ally support", () => {
  it("is shown to owners only", () => {
    const { container } = render(<StaffAccess bot={{ id: BOT } as never} canManage={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("allows conversations for 24 hours by default, with a reason", async () => {
    grant.mockReturnValue(ok());
    render(<StaffAccessPanel botId={BOT} />);
    expect(screen.getByTestId("staff-access-state")).toHaveTextContent(
      STAFF_SUPPORT_COPY.owner.noneLive,
    );
    fireEvent.change(screen.getByPlaceholderText(STAFF_SUPPORT_COPY.owner.reasonLabel), {
      target: { value: " ticket 42 " },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: STAFF_SUPPORT_COPY.owner.allow }));
    });
    expect(grant).toHaveBeenCalledWith({ id: BOT, hours: 24, reason: "ticket 42" });
    expect(refetch).toHaveBeenCalled();
  });

  it("offers nothing longer than 7 days", () => {
    render(<StaffAccessPanel botId={BOT} />);
    const values = Array.from(
      screen.getByLabelText(STAFF_SUPPORT_COPY.owner.allowLabel).querySelectorAll("option"),
    ).map(o => Number((o as HTMLOptionElement).value));
    expect(Math.max(...values)).toBe(168);
  });

  it("shows a live grant and stops it at once", async () => {
    grants = [
      { id: "g1", status: "live", expiresAt: new Date(Date.now() + 3600_000).toISOString() },
    ];
    revoke.mockReturnValue(ok());
    render(<StaffAccessPanel botId={BOT} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: STAFF_SUPPORT_COPY.owner.revoke }));
    });
    expect(revoke).toHaveBeenCalledWith({ id: BOT, grantId: "g1" });
    expect(screen.getByText(STAFF_SUPPORT_COPY.owner.revoked)).toBeInTheDocument();
  });

  it("lists who looked, and says when no one has", () => {
    const { unmount } = render(<StaffAccessPanel botId={BOT} />);
    expect(screen.getByText(STAFF_SUPPORT_COPY.owner.viewsEmpty)).toBeInTheDocument();
    unmount();
    views = [
      {
        id: "v1",
        at: new Date().toISOString(),
        staffName: "Asha",
        what: "A conversation",
        conversations: true,
      },
    ];
    render(<StaffAccessPanel botId={BOT} />);
    expect(screen.getByTestId("staff-views")).toHaveTextContent("Asha looked at a conversation");
  });

  it("explains a refused grant", async () => {
    grant.mockReturnValue({ unwrap: () => Promise.reject({ status: 403 }) });
    render(<StaffAccessPanel botId={BOT} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: STAFF_SUPPORT_COPY.owner.allow }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(STAFF_SUPPORT_COPY.owner.failed);
  });
});

describe("Staff: search and read-only view", () => {
  it("searches only when asked, and lists owners with an open link", () => {
    hits = [
      {
        id: BOT,
        name: "Sunrise Yoga",
        archived: false,
        owners: [{ name: "Org Admin", email: "o@x.test", tenantId: null }],
        conversationsAllowed: true,
      },
    ];
    render(
      <MemoryRouter>
        <ChatbotSupportSearch />
      </MemoryRouter>,
    );
    expect(searchArgs.at(-1)).toEqual(["", true]);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: " sun " } });
    fireEvent.submit(screen.getByRole("search"));
    expect(searchArgs.at(-1)).toEqual(["sun", false]);
    expect(screen.getByTestId("chatbot-support-results")).toHaveTextContent("Org Admin (o@x.test)");
    expect(
      screen.getByRole("link", { name: `${STAFF_SUPPORT_COPY.page.open}: Sunrise Yoga` }),
    ).toHaveAttribute("href", `/admin/chatbot-support/${BOT}`);
  });

  it("says when nothing matches", () => {
    render(
      <MemoryRouter>
        <ChatbotSupportSearch />
      </MemoryRouter>,
    );
    fireEvent.submit(screen.getByRole("search"));
    expect(screen.getByText(STAFF_SUPPORT_COPY.page.empty)).toBeInTheDocument();
  });

  it("the read-only frame shows the banner and disables every input, even later ones", async () => {
    const Late: React.FC = () => {
      const [shown, setShown] = React.useState(false);
      React.useEffect(() => setShown(true), []);
      return shown ? <input aria-label="Late" /> : null;
    };
    render(
      <ReadOnlyFrame>
        <input aria-label="Name" />
        <textarea aria-label="Instructions" />
        <select aria-label="Tone">
          <option>Warm</option>
        </select>
        <button type="button">Overview</button>
        <Late />
      </ReadOnlyFrame>,
    );
    expect(screen.getByTestId("staff-read-only-banner")).toHaveTextContent(
      STAFF_SUPPORT_COPY.banner.title,
    );
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("Instructions")).toBeDisabled();
    expect(screen.getByLabelText("Tone")).toBeDisabled();
    // Section navigation still works.
    expect(screen.getByRole("button", { name: "Overview" })).toBeEnabled();
    await waitFor(() => expect(screen.getByLabelText("Late")).toBeDisabled());
  });
});
