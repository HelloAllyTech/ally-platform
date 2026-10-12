import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExternalResourceModal } from "../ExternalResourceModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const resource = {
  id: "r1",
  title: "Mental Health First Aid Guide",
  url: "https://example.com/guide",
};

describe("ExternalResourceModal", () => {
  it("renders the resource in an iframe with the right title and src", () => {
    render(<ExternalResourceModal resource={resource} onClose={vi.fn()} />);

    const iframe = screen.getByTitle(resource.title) as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(iframe.src).toBe(resource.url);
  });

  it("always shows the open-in-new-tab action, regardless of iframe load state", () => {
    render(<ExternalResourceModal resource={resource} onClose={vi.fn()} />);

    // Present before the iframe's onLoad ever fires — the escape hatch for a
    // frame blocked by X-Frame-Options/CSP, which never reports a load error.
    expect(screen.getAllByText("tracks2.article.openInNewTab").length).toBeGreaterThan(0);
  });

  it("opens the resource URL in a new tab when the action is pressed", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<ExternalResourceModal resource={resource} onClose={vi.fn()} />);

    const [button] = screen.getAllByTestId("drawer-header-button-open-in-new-tab");
    button.click();

    expect(openSpy).toHaveBeenCalledWith(resource.url, "_blank", "noopener,noreferrer");
    openSpy.mockRestore();
  });
});
