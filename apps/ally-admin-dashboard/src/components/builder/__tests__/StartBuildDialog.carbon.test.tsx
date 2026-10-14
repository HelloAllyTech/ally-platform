import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BuilderPrdReadiness } from "@types";

/**
 * The sibling StartBuildDialog.test.tsx mocks `@ally-ui-mono/ui-shared` wholesale, so it kept
 * passing while the real dialog took the whole Builder session page down: Carbon's
 * InlineNotification throws when it finds a control among its children ("component should have
 * no interactive child nodes"), and the "Review the design" button sat inside one. The ES build
 * Vite bundles throws in production too, and BuilderSession keeps this dialog mounted while
 * closed — so every session with an unapproved design crashed on load. This file renders the real
 * components and stubs only the network.
 */

// @constants reads off the @components barrel at module-eval time, so the barrel is stubbed.
vi.mock("@components", () => ({ cellTypes: {} }));
vi.mock("@assets", () => ({ TooltipIcon: () => <svg /> }));
vi.mock("@api", () => ({
  useGetBuilderRepoCommandsQuery: () => ({ data: { repos: [] } }),
  useUpdateBuilderSessionMutation: () => [vi.fn(), { isLoading: false }],
  useStartBuilderBuildMutation: () => [vi.fn(), { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { StartBuildDialog } from "../StartBuildDialog";

const readiness: BuilderPrdReadiness = { score: 100, ready: true, sections: [], blockers: [] };

const baseProps = {
  onClose: vi.fn(),
  sessionId: "session-1",
  currentRepos: [],
  readiness,
  onStarted: vi.fn(),
};

describe("StartBuildDialog on real Carbon", () => {
  it("mounts closed with a design block, as the session page holds it", () => {
    render(
      <StartBuildDialog
        {...baseProps}
        isOpen={false}
        designBlock="notApproved"
        onReviewDesign={vi.fn()}
      />,
    );

    expect(screen.getByText("Approve the technical design first")).toBeInTheDocument();
  });

  it("leads from the design block to the design", () => {
    const onReviewDesign = vi.fn();
    render(
      <StartBuildDialog
        {...baseProps}
        isOpen
        designBlock="stale"
        onReviewDesign={onReviewDesign}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Review the design" }));
    expect(onReviewDesign).toHaveBeenCalledTimes(1);
  });
});
