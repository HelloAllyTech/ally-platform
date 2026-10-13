import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// See BugFindingsTable's note: @constants reads `cellTypes` off this barrel at
// module-eval time.
vi.mock("@components", () => ({ cellTypes: {} }));

import { BugFindingStatus } from "@types";

import { BugFindingStatusBadge } from "../BugFindingStatusBadge";
import { BUG_FINDING_STATUS_LABELS } from "../bugFindingLabels";

const tone = (status: BugFindingStatus) => {
  const { unmount } = render(<BugFindingStatusBadge status={status} />);
  const className = screen.getByText(BUG_FINDING_STATUS_LABELS[status]).className;
  unmount();
  if (className.includes("orange")) return "needs you";
  if (className.includes("destructive")) return "failed";
  if (className.includes("green")) return "live";
  if (/amber|blue/.test(className)) return "other colour";
  return "grey";
};

/**
 * Four meanings, and only four. Amber used to mean both "waiting on you" and
 * "agent working"; working is the spinner beside the badge now.
 */
describe("BugFindingStatusBadge", () => {
  it("is orange for needs you, red for failed, green for live, grey for the rest", () => {
    const expected: Record<string, string[]> = {
      "needs you": [BugFindingStatus.PENDING_APPROVAL, BugFindingStatus.NEEDS_INPUT],
      failed: [BugFindingStatus.FAILED, BugFindingStatus.RELEASE_FAILED],
      live: [BugFindingStatus.RELEASED],
    };
    const coloured = Object.values(expected).flat();

    Object.values(BugFindingStatus).forEach(status => {
      const want =
        Object.entries(expected).find(([, statuses]) => statuses.includes(status))?.[0] ?? "grey";
      expect({ status, tone: tone(status) }).toEqual({ status, tone: want });
    });
    expect(coloured).toHaveLength(5);
  });

  it("does not colour an agent-working status", () => {
    [
      BugFindingStatus.QUEUED,
      BugFindingStatus.FIXING,
      BugFindingStatus.COORDINATING,
      BugFindingStatus.RELEASING,
    ].forEach(status => expect(tone(status)).toBe("grey"));
  });
});
