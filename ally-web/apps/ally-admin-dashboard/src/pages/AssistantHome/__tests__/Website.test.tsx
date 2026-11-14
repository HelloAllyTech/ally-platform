import { fireEvent, render, screen } from "@testing-library/react";

import type { WidgetSettings } from "@types";

import { HOME } from "../copy";
import { WebsiteGroup, widgetSnippet } from "../sections/Website";

import type { HomeField } from "../useHomeField";

const t = HOME.website;
const VALUE: WidgetSettings = {
  position: "right",
  label: "Ask us",
  autoOpenSeconds: null,
  showOnPhones: true,
  allowedDomains: ["sunrisemind.in"],
};

function setup(over: Partial<HomeField<WidgetSettings>> = {}, publicAllowed = false) {
  const field = {
    value: VALUE,
    set: vi.fn(),
    flush: vi.fn(),
    saving: false,
    error: null,
    ...over,
  } as HomeField<WidgetSettings> & { set: ReturnType<typeof vi.fn> };
  render(
    <WebsiteGroup
      field={field}
      slug="sunrise-mind"
      pageLink="https://chat.ally.test/b/sunrise-mind"
      publicAllowed={publicAllowed}
      disabled={false}
    />,
  );
  return field;
}

describe("On your website (chunk 13)", () => {
  it("gives the one line to paste, from the bot page's own address", () => {
    setup();
    expect(widgetSnippet("https://chat.ally.test/b/sunrise-mind", "sunrise-mind")).toBe(
      '<script src="https://chat.ally.test/widget.js" data-assistant="sunrise-mind" async></script>',
    );
    expect(
      screen.getByText(
        '<script src="https://chat.ally.test/widget.js" data-assistant="sunrise-mind" async></script>',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.copy })).toBeInTheDocument();
  });

  it("adds a website with Add or Enter (not as you type), and removes one", () => {
    const field = setup();
    const input = screen.getByLabelText(t.address);
    fireEvent.change(input, { target: { value: "book.sunrisemind.in" } });
    expect(field.set).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(field.set).toHaveBeenLastCalledWith(
      { ...VALUE, allowedDomains: ["sunrisemind.in", "book.sunrisemind.in"] },
      { now: true },
    );
    fireEvent.click(screen.getByRole("button", { name: `${t.remove}: sunrisemind.in` }));
    expect(field.set).toHaveBeenLastCalledWith({ ...VALUE, allowedDomains: [] }, { now: true });
  });

  it("shows ally-be's reason when a website is refused", () => {
    setup({
      error:
        "wixsite.com is shared by many websites, so the bubble could appear on sites that aren't yours. Add your own address on it, for example yourclinic.wixsite.com.",
    });
    expect(screen.getByRole("alert")).toHaveTextContent("wixsite.com is shared by many websites");
  });

  it("says nothing appears until a website is added", () => {
    setup({ value: { ...VALUE, allowedDomains: [] } });
    expect(screen.getByText(t.none)).toBeInTheDocument();
  });

  it("saves the bubble's position, opening on its own and phones", () => {
    const field = setup();
    fireEvent.click(screen.getByLabelText(t.left));
    expect(field.set).toHaveBeenLastCalledWith({ ...VALUE, position: "left" }, { now: true });
    fireEvent.click(screen.getByLabelText("Open on its own after 10 seconds"));
    expect(field.set).toHaveBeenLastCalledWith({ ...VALUE, autoOpenSeconds: 10 }, { now: true });
    fireEvent.click(screen.getByLabelText(t.phones));
    expect(field.set).toHaveBeenLastCalledWith({ ...VALUE, showOnPhones: false }, { now: true });
  });

  it("notes public chat is coming while public links are off", () => {
    setup();
    expect(screen.getByText(t.publicNote)).toBeInTheDocument();
  });

  it("helps with sites that set a Content-Security-Policy", () => {
    setup({}, true);
    expect(screen.queryByText(t.publicNote)).not.toBeInTheDocument();
    expect(
      screen.getByText(/allow https:\/\/chat\.ally\.test in script-src and frame-src/),
    ).toBeInTheDocument();
  });
});
