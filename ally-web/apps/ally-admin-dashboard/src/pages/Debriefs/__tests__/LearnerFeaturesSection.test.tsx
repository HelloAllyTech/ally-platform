import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// `@constants` first: the admin app's barrel does module-load-time work.
import "@constants";

const mockGrant = vi.fn();
const mockRevoke = vi.fn();
const mockEveryone = vi.fn();
let mockView: any = {
  feature: "selection_comments",
  everyone: false,
  people: [
    {
      userId: 9,
      name: "Tanuja Babre",
      email: "tanuja.babre+internal@helloally.ai",
      addedAt: "2026-11-19T00:00:00Z",
    },
  ],
};
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@api", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGetDebriefLearnerFeatureQuery: () => ({ data: mockView, isError: false }),
  useGrantDebriefLearnerFeatureMutation: () => [mockGrant, { isLoading: false }],
  useRevokeDebriefLearnerFeatureMutation: () => [mockRevoke, { isLoading: false }],
  useSetDebriefLearnerFeatureEveryoneMutation: () => [mockEveryone, { isLoading: false }],
}));

/* eslint-disable import/first */
import { LearnerFeaturesSection } from "../settings/LearnerFeaturesSection";
/* eslint-enable import/first */

const ok = (value: unknown) => ({ unwrap: () => Promise.resolve(value) });

describe("Settings › Learner features", () => {
  beforeEach(() => {
    mockGrant.mockReset().mockReturnValue(ok({}));
    mockRevoke.mockReset().mockReturnValue(ok({}));
    mockEveryone.mockReset().mockReturnValue(ok({}));
    mockView = {
      feature: "selection_comments",
      everyone: false,
      people: [
        {
          userId: 9,
          name: "Tanuja Babre",
          email: "tanuja.babre+internal@helloally.ai",
          addedAt: "2026-11-19T00:00:00Z",
        },
      ],
    };
  });

  it("lists who has it, with the email, and everyone as off", () => {
    render(<LearnerFeaturesSection canEdit />);
    expect(screen.getByTestId("learner-feature-person-9")).toHaveTextContent("Tanuja Babre");
    expect(screen.getByTestId("learner-feature-person-9")).toHaveTextContent(
      "tanuja.babre+internal@helloally.ai",
    );
    expect(screen.getByTestId("learner-feature-everyone")).toHaveAttribute("aria-checked", "false");
  });

  it("gives access by email and asks for one first", async () => {
    render(<LearnerFeaturesSection canEdit />);
    fireEvent.click(screen.getByTestId("learner-feature-give"));
    expect(screen.getByTestId("learner-feature-problem")).toBeInTheDocument();
    expect(mockGrant).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId("learner-feature-email"), {
      target: { value: " sandeep@x.com " },
    });
    fireEvent.click(screen.getByTestId("learner-feature-give"));
    await waitFor(() =>
      expect(mockGrant).toHaveBeenCalledWith({
        feature: "selection_comments",
        email: "sandeep@x.com",
      }),
    );
  });

  it("shows the server's reason when the email has no account", async () => {
    mockGrant.mockReturnValue({
      unwrap: () => Promise.reject({ data: { message: "No account has that email." } }),
    });
    render(<LearnerFeaturesSection canEdit />);
    fireEvent.change(screen.getByTestId("learner-feature-email"), {
      target: { value: "nobody@x.com" },
    });
    fireEvent.click(screen.getByTestId("learner-feature-give"));
    await waitFor(() =>
      expect(screen.getByTestId("learner-feature-problem")).toHaveTextContent(
        "No account has that email.",
      ),
    );
  });

  it("removes a person and switches everyone on", async () => {
    render(<LearnerFeaturesSection canEdit />);
    fireEvent.click(screen.getByTestId("learner-feature-remove-9"));
    await waitFor(() =>
      expect(mockRevoke).toHaveBeenCalledWith({ feature: "selection_comments", userId: 9 }),
    );
    fireEvent.click(screen.getByTestId("learner-feature-everyone"));
    await waitFor(() =>
      expect(mockEveryone).toHaveBeenCalledWith({ feature: "selection_comments", on: true }),
    );
  });

  it("is read only without the right: no box, no remove, a disabled switch", () => {
    render(<LearnerFeaturesSection canEdit={false} />);
    expect(screen.queryByTestId("learner-feature-email")).not.toBeInTheDocument();
    expect(screen.queryByTestId("learner-feature-remove-9")).not.toBeInTheDocument();
    expect(screen.getByTestId("learner-feature-everyone")).toBeDisabled();
  });
});
