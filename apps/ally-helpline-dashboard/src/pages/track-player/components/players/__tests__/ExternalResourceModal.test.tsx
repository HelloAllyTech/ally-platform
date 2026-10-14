import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "sonner";

import { ExternalResourceModal } from "../ExternalResourceModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("sonner", () => ({
  toast: { info: vi.fn() },
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

  describe("embed timeout fallback", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("falls back to a new tab if the embed never fires onLoad", () => {
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      const onClose = vi.fn();
      render(<ExternalResourceModal resource={resource} onClose={onClose} />);

      vi.advanceTimersByTime(8000);

      expect(openSpy).toHaveBeenCalledWith(resource.url, "_blank", "noopener,noreferrer");
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(toast.info).toHaveBeenCalledWith("tracks2.article.embedTimedOut");
      openSpy.mockRestore();
    });

    it("does not fall back once the embed actually loads", () => {
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      const onClose = vi.fn();
      render(<ExternalResourceModal resource={resource} onClose={onClose} />);

      fireEvent.load(screen.getByTitle(resource.title));
      vi.advanceTimersByTime(8000);

      expect(openSpy).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      openSpy.mockRestore();
    });
  });
});
