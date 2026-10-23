import { FC } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UxSignalScanStatus, UxSignalScanTrigger } from "@types";

const invalidateTags = vi.fn();
const startScan = vi.fn();
const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() };

vi.mock("@api", () => ({
  useScanUxSignalsMutation: vi.fn(() => [startScan, { isLoading: false }]),
  useGetUxSignalScansQuery: vi.fn(() => ({ data: { scans: [] } })),
  baseAPI: { util: { invalidateTags: (tags: unknown) => invalidateTags(tags) } },
}));

vi.mock("react-redux", () => ({
  useSelector: (selector: any) => selector({ user: { features: ["ux_signals"] } }),
  useDispatch: () => (action: unknown) => action,
}));

vi.mock("@utils", () => ({
  hasFeature: (features: string[], key: string) => features.includes(key),
}));

vi.mock("@components", () => ({ cellTypes: {} }));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toast.success(...args),
    warning: (...args: unknown[]) => toast.warning(...args),
    error: (...args: unknown[]) => toast.error(...args),
    info: (...args: unknown[]) => toast.info(...args),
  },
}));

import * as api from "@api";

import { useUxSignalScan } from "../useUxSignalScan";

/** The hook's surface, as the header's menu item would render it. */
const Probe: FC = () => {
  const scan = useUxSignalScan();
  if (!scan.canScan) return <p>no scan</p>;
  return (
    <div>
      <button onClick={() => void scan.runScan()} disabled={scan.isBusy}>
        scan
      </button>
      <p data-testid="last-scan">{scan.lastScanLine}</p>
    </div>
  );
};

/**
 * The scan's job is to say only what it knows.
 *
 * Its predecessor held one HTTP request open for the whole two-minute scan and
 * reported whatever that request did as the scan's outcome. In production the
 * gateway hung up at 60s and an admin was told the scan "could not be completed.
 * Nothing was filed" — while the scan ran on and filed seven findings. These
 * tests moved here from UxSignalsPanel on 2026-10-13, when the bar became a
 * menu item and its inline result became a toast.
 */
describe("useUxSignalScan", () => {
  const scan = (over: Partial<Record<string, unknown>> = {}) => ({
    id: "scan-1",
    trigger: UxSignalScanTrigger.MANUAL,
    status: UxSignalScanStatus.COMPLETED,
    windowFrom: "2026-08-26",
    windowTo: "2026-09-02",
    signalsDetected: 9,
    findingsCreated: 7,
    suggestionsCreated: 2,
    skippedDuplicates: 1,
    failedDetectors: [],
    error: null,
    startedBy: 1,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    ...over,
  });

  const withScans = (...scans: unknown[]) =>
    (api.useGetUxSignalScansQuery as any).mockReturnValue({ data: { scans } });

  beforeEach(() => {
    vi.clearAllMocks();
    (api.useScanUxSignalsMutation as any).mockReturnValue([startScan, { isLoading: false }]);
    withScans();
  });

  it("says a scan started, and claims nothing about its outcome yet", async () => {
    startScan.mockReturnValue({ unwrap: async () => ({ scanId: "scan-1" }) });
    const { rerender } = render(<Probe />);

    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(startScan).toHaveBeenCalled());

    expect(toast.info).toHaveBeenCalledWith(
      "Scanning telemetry…",
      expect.objectContaining({ description: expect.stringContaining("about two minutes") }),
    );
    expect(toast.success).not.toHaveBeenCalled();
    // Disabled from the click itself, not from the next poll — a second press in
    // that gap could only earn a 409.
    expect(screen.getByRole("button")).toBeDisabled();

    withScans(scan({ status: UxSignalScanStatus.RUNNING, finishedAt: null }));
    rerender(<Probe />);

    expect(screen.getByTestId("last-scan")).toHaveTextContent(/A scan is running now/);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("toasts the counts once the scan log says it finished, and refreshes both queues", async () => {
    startScan.mockReturnValue({ unwrap: async () => ({ scanId: "scan-1" }) });
    const { rerender } = render(<Probe />);

    withScans(scan({ status: UxSignalScanStatus.RUNNING, finishedAt: null }));
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(startScan).toHaveBeenCalled());

    withScans(scan());
    rerender(<Probe />);

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Scan complete: 7 bugs and 2 suggestions filed.",
        expect.objectContaining({
          description: "9 signals crossed a threshold; 1 were already known.",
        }),
      ),
    );
    // The findings only exist now, so this is the first moment either table has
    // anything new to fetch.
    expect(invalidateTags).toHaveBeenCalled();
  });

  it("warns rather than celebrates when a detector could not run", async () => {
    startScan.mockReturnValue({ unwrap: async () => ({ scanId: "scan-1" }) });
    const { rerender } = render(<Probe />);

    withScans(scan({ status: UxSignalScanStatus.RUNNING, finishedAt: null }));
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(startScan).toHaveBeenCalled());

    withScans(scan({ failedDetectors: ["rage_clicks"] }));
    rerender(<Probe />);

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(toast.warning.mock.calls[0][1].description).toContain("rage_clicks");
  });

  it("names the reason a scan failed rather than sending the reader to find a log", async () => {
    startScan.mockReturnValue({ unwrap: async () => ({ scanId: "scan-1" }) });
    const { rerender } = render(<Probe />);

    withScans(scan({ status: UxSignalScanStatus.RUNNING, finishedAt: null }));
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(startScan).toHaveBeenCalled());

    withScans(
      scan({
        status: UxSignalScanStatus.FAILED,
        error: "PostHog rejected the query (403)",
        findingsCreated: 0,
        suggestionsCreated: 0,
      }),
    );
    rerender(<Probe />);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("The scan failed: PostHog rejected the query (403)"),
    );
    // A failed scan must never be invalidated into the queues as though it wrote.
    expect(invalidateTags).not.toHaveBeenCalled();
  });

  // A nightly scan that finished before the page opened is the last-scan
  // line's to report, not a pop-up's.
  it("does not toast a scan it never saw running", () => {
    withScans(scan());
    render(<Probe />);

    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByTestId("last-scan")).toHaveTextContent(/7 bugs, 2 suggestions filed/);
  });

  it("stops waiting on a scan that died mid-run instead of spinning forever", () => {
    withScans(
      scan({
        status: UxSignalScanStatus.RUNNING,
        finishedAt: null,
        startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      }),
    );

    render(<Probe />);

    expect(screen.getByTestId("last-scan")).toHaveTextContent(/never reported back/);
    expect(screen.getByRole("button")).not.toBeDisabled();
  });

  it("re-enables the item when the scan it was watching goes stale mid-wait", async () => {
    startScan.mockReturnValue({ unwrap: async () => ({ scanId: "scan-1" }) });
    const { rerender } = render(<Probe />);

    withScans(
      scan({
        status: UxSignalScanStatus.RUNNING,
        finishedAt: null,
        startedAt: new Date().toISOString(),
      }),
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(startScan).toHaveBeenCalled());

    rerender(<Probe />);
    expect(screen.getByRole("button")).toBeDisabled();

    withScans(
      scan({
        status: UxSignalScanStatus.RUNNING,
        finishedAt: null,
        startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      }),
    );
    rerender(<Probe />);

    expect(screen.getByTestId("last-scan")).toHaveTextContent(/never reported back/);
    expect(screen.getByRole("button")).not.toBeDisabled();
  });

  it("does not claim nothing was filed when it could not confirm the start", async () => {
    startScan.mockReturnValue({
      unwrap: async () => {
        throw { status: 504, data: "<html>Gateway Timeout</html>" };
      },
    });

    render(<Probe />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error.mock.calls[0][0]).toMatch(/Couldn’t confirm the scan started/);
    expect(toast.error.mock.calls[0][0]).not.toMatch(/Nothing was filed/);
  });

  it("answers a 409 in its own words", async () => {
    startScan.mockReturnValue({
      unwrap: async () => {
        throw { status: 409, data: { message: "A UX Signals scan is already running." } };
      },
    });

    render(<Probe />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "A scan is already running. Wait for it to finish before starting another.",
      ),
    );
  });
});
