import "@constants";
import React from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "@constants";

const mockSearch = vi.fn();
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSearchManualQuery: (args: { q: string }, options: { skip?: boolean }) =>
    mockSearch(args, options),
}));

import { SearchPalette } from "../components/SearchPalette";

const hits = [
  {
    slug: "start-a-roleplay",
    title: "Start a roleplay",
    parentTitle: "Practice",
    snippet: 'Open a <mark>roleplay</mark> <img src=x onerror="boom">',
    rank: 1,
  },
  { slug: "scores", title: "Scores", parentTitle: null, snippet: "", rank: 0.5 },
];

const setup = (overrides: Partial<React.ComponentProps<typeof SearchPalette>> = {}) => {
  const props = {
    open: true,
    onClose: vi.fn(),
    onOpenPage: vi.fn(),
    onAsk: vi.fn(),
    recent: [{ slug: "invite", title: "Invite people" }],
    ...overrides,
  };
  render(<SearchPalette {...props} />);
  return props;
};

const input = () => screen.getByRole("combobox");
const options = () => screen.getAllByRole("option");

describe("SearchPalette", () => {
  beforeEach(() => {
    mockSearch.mockReset();
    mockSearch.mockImplementation((args: { q: string }, options: { skip?: boolean }) =>
      options.skip
        ? { data: undefined, isFetching: false, isError: false }
        : { data: args.q === "role" ? hits : [], isFetching: false, isError: false },
    );
  });

  it("shows recent pages and the Ask row before anything is typed", () => {
    const props = setup();
    expect(
      screen.getByRole("dialog", { name: en.productManual.palette.label }),
    ).toBeInTheDocument();
    expect(options().map(option => option.textContent)).toEqual([
      "Invite people",
      en.productManual.palette.askEmpty,
    ]);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(props.onOpenPage).toHaveBeenCalledWith("invite");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("does not search below two characters", async () => {
    setup();
    fireEvent.change(input(), { target: { value: "r" } });
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(mockSearch).not.toHaveBeenCalledWith(expect.anything(), { skip: false });
  });

  it("searches after a pause, moves with the arrows and opens on Enter", async () => {
    const props = setup();
    fireEvent.change(input(), { target: { value: "role" } });
    await waitFor(() => expect(options()).toHaveLength(3));
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Practice /")).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(options()[1]).toHaveAttribute("aria-selected", "true");
    expect(input()).toHaveAttribute("aria-activedescendant", options()[1].id);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(props.onOpenPage).toHaveBeenCalledWith("scores");
  });

  it("renders the snippet's <mark> as a highlight and any other tag as text", async () => {
    setup();
    fireEvent.change(input(), { target: { value: "role" } });
    await waitFor(() => expect(options()).toHaveLength(3));
    const mark = options()[0].querySelector("mark");
    expect(mark?.textContent).toBe("roleplay");
    expect(document.querySelector("img")).toBeNull();
    expect(options()[0].textContent).toContain('<img src=x onerror="boom">');
  });

  it("ends with Ask the manual about the query, which wraps round from the top", async () => {
    const props = setup();
    fireEvent.change(input(), { target: { value: "role" } });
    await waitFor(() => expect(options()).toHaveLength(3));
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(options()[2]).toHaveTextContent(en.productManual.palette.ask("role"));
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(props.onAsk).toHaveBeenCalledWith("role");
    expect(props.onOpenPage).not.toHaveBeenCalled();
  });

  it("says when nothing matches, and closes on Escape", async () => {
    const props = setup();
    fireEvent.change(input(), { target: { value: "zebra" } });
    await waitFor(() =>
      expect(screen.getByText(en.productManual.palette.noResults)).toBeInTheDocument(),
    );
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("renders nothing while closed", () => {
    setup({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
