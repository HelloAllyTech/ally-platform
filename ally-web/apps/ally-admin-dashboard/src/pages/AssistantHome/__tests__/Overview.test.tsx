import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

/**
 * The Overview's numbers (chunk 20d-2): the last 30 days by default, as the list counted them, and
 * the last 7 days when chosen, asked for only then.
 */
const numbers = vi.fn();
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useArchiveChatbotMutation: () => [vi.fn(), { isLoading: false }],
  useSetChatbotStatusMutation: () => [vi.fn(), { isLoading: false }],
  useGetHomeNumbersQuery: (arg: unknown, options: { skip: boolean }) => numbers(arg, options),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../sections/Scorecard", () => ({ Scorecard: () => null }));
vi.mock("../../Onboarding/Screens", () => ({ Qr: () => null }));
vi.mock("../sections/AllNumbers", () => ({
  AllNumbers: () => <div data-testid="all-numbers" />,
}));

const { OverviewSection } = await import("../sections/Overview");
const { HOME } = await import("../copy");
const t = HOME.overview;

const BOT = {
  id: "bot-1",
  status: "live",
  stats: { people: 40, messages: 300, answered: 250, declined: 20, openUnanswered: 3 },
};

const shown = () =>
  [...screen.getByTestId("overview-numbers").querySelectorAll("dd")].map(dd => dd.textContent);

describe("the Overview's numbers", () => {
  it("shows the last 30 days, then the last 7 when chosen", () => {
    numbers.mockImplementation((_arg, { skip }) => ({
      data: skip
        ? undefined
        : { days: 7, people: 9, messages: 70, answered: 60, declined: 4, openUnanswered: 3 },
    }));
    render(
      <OverviewSection
        {...({ bot: BOT, page: null, canEdit: true, canManage: false, go: vi.fn() } as never)}
      />,
    );
    expect(shown()).toEqual(["40", "300", "250", "20"]);
    expect(numbers).toHaveBeenLastCalledWith({ id: "bot-1", days: 7 }, { skip: true });

    fireEvent.click(screen.getByRole("radio", { name: t.last7 }));
    expect(numbers).toHaveBeenLastCalledWith({ id: "bot-1", days: 7 }, { skip: false });
    expect(shown()).toEqual(["9", "70", "60", "4"]);

    fireEvent.click(screen.getByRole("radio", { name: t.last30 }));
    expect(shown()).toEqual(["40", "300", "250", "20"]);
  });

  it("opens All numbers in place, and an old usage link arrives with it open", () => {
    numbers.mockReturnValue({ data: undefined });
    const props = { bot: BOT, page: null, canEdit: true, canManage: false, go: vi.fn() };
    const { unmount } = render(<OverviewSection {...(props as never)} />);
    // Nothing loads until it's opened.
    expect(screen.queryByTestId("all-numbers")).toBeNull();
    const toggle = screen.getByRole("button", { name: t.seeAllNumbers });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByTestId("all-numbers")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: HOME.allNumbers.hide }).getAttribute("aria-expanded"),
    ).toBe("true");
    // No link to the classic view any more.
    expect(document.querySelector('a[href*="view=classic"]')).toBeNull();
    unmount();

    render(<OverviewSection {...({ ...props, openAllNumbers: true } as never)} />);
    expect(screen.getByTestId("all-numbers")).toBeTruthy();
  });
});
