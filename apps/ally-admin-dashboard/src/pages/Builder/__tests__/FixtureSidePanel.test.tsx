import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { interviewFixture, reviewFixture } from "./evalTestData";

vi.mock("@components", () => ({ cellTypes: {} }));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<any>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

const updateFixture = vi.fn();
const deleteFixture = vi.fn();
vi.mock("@api", () => ({
  useUpdateBuilderEvalFixtureMutation: () => [updateFixture, { isLoading: false }],
  useDeleteBuilderEvalFixtureMutation: () => [deleteFixture, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { en } from "@constants";

// eslint-disable-next-line import/first
import { FixtureSidePanel } from "../eval/FixtureSidePanel";

const strings = en.builder.eval;
const panel = strings.fixturePanel;

const ok = <T,>(value: T) => ({ unwrap: () => Promise.resolve(value) });
const refused = (status: number, message?: string) => ({
  unwrap: () => Promise.reject({ status, data: message ? { message } : undefined }),
});

const renderPanel = (fixture = interviewFixture(), onClose = vi.fn()) => {
  const view = render(
    <MemoryRouter>
      <FixtureSidePanel fixture={fixture} onClose={onClose} />
    </MemoryRouter>,
  );
  return { ...view, onClose };
};

const saveButton = () => screen.getByRole("button", { name: panel.save });

beforeEach(() => {
  vi.clearAllMocks();
  updateFixture.mockReturnValue(ok({}));
  deleteFixture.mockReturnValue(ok({ deleted: true }));
});

describe("FixtureSidePanel", () => {
  it("renders nothing without a fixture", () => {
    const { container } = render(
      <MemoryRouter>
        <FixtureSidePanel fixture={null} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the fixture: name, note, what the admin said, and the checklist", () => {
    renderPanel();

    expect(screen.getByLabelText(panel.nameLabel)).toHaveValue("Digest email");
    expect(screen.getByLabelText(panel.notesLabel, { exact: false })).toHaveValue(
      "Session 2bc3a5cf asked six questions it never read.",
    );
    expect(screen.getByText("A weekly digest email summarising what shipped")).toBeInTheDocument();
    expect(screen.getByText(panel.scriptSummary(2))).toBeInTheDocument();
    expect(screen.getByLabelText(strings.checklist.textLabel("C1"))).toHaveValue(
      "Reuses the existing digest job",
    );
  });

  it("links back to the session the fixture was cut from", () => {
    renderPanel();

    expect(screen.getByText(panel.sourceSession("2bc3a5cf"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: panel.openSession }));
    expect(navigateMock).toHaveBeenCalledWith("/builder/2bc3a5cf-0000-4000-8000-000000000000");
  });

  describe("saving", () => {
    it("waits until something has changed", () => {
      renderPanel();
      expect(saveButton()).toBeDisabled();

      fireEvent.change(screen.getByLabelText(strings.checklist.textLabel("C1")), {
        target: { value: "Reuses the digest job and its schedule" },
      });
      expect(saveButton()).toBeEnabled();
    });

    it("saves an edited checklist, with the name and note it was opened with", async () => {
      renderPanel();

      fireEvent.change(screen.getByLabelText(strings.checklist.textLabel("C2")), {
        target: { value: "Plans a new queue for digests" },
      });
      fireEvent.change(screen.getByLabelText(strings.checklist.kindLabel("C2")), {
        target: { value: "must" },
      });
      fireEvent.click(saveButton());

      await waitFor(() => expect(updateFixture).toHaveBeenCalledTimes(1));
      expect(updateFixture).toHaveBeenCalledWith({
        id: "fix-1",
        name: "Digest email",
        notes: "Session 2bc3a5cf asked six questions it never read.",
        checklist: [
          { id: "C1", text: "Reuses the existing digest job", kind: "must" },
          { id: "C2", text: "Plans a new queue for digests", kind: "must" },
        ],
      });
      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(panel.saved));
    });

    it("adds an item, drops one, and leaves out blanks", async () => {
      renderPanel();

      fireEvent.click(screen.getByRole("button", { name: strings.checklist.remove("C1") }));
      fireEvent.click(screen.getByRole("button", { name: strings.checklist.add }));
      fireEvent.change(screen.getByLabelText(strings.checklist.textLabel("C3")), {
        target: { value: "  Names the owner of the digest  " },
      });
      // A second add left blank: not sent.
      fireEvent.click(screen.getByRole("button", { name: strings.checklist.add }));
      fireEvent.click(saveButton());

      await waitFor(() => expect(updateFixture).toHaveBeenCalled());
      expect(updateFixture.mock.calls[0][0].checklist).toEqual([
        { id: "C2", text: "Plans a new table for digests", kind: "must_not" },
        { id: "C3", text: "Names the owner of the digest", kind: "must" },
      ]);
    });

    it("saves the note and the name", async () => {
      renderPanel();

      fireEvent.change(screen.getByLabelText(panel.nameLabel), {
        target: { value: "  Digest email, v2  " },
      });
      fireEvent.change(screen.getByLabelText(panel.notesLabel, { exact: false }), {
        target: { value: "Reproduces the unseen-failure gate." },
      });
      fireEvent.click(saveButton());

      await waitFor(() => expect(updateFixture).toHaveBeenCalled());
      expect(updateFixture.mock.calls[0][0]).toMatchObject({
        id: "fix-1",
        name: "Digest email, v2",
        notes: "Reproduces the unseen-failure gate.",
      });
    });

    it("will not save a fixture with no name", () => {
      renderPanel();
      fireEvent.change(screen.getByLabelText(panel.nameLabel), { target: { value: "   " } });
      expect(saveButton()).toBeDisabled();
    });

    it("shows the server's message when it refuses (a name already taken)", async () => {
      updateFixture.mockReturnValue(refused(409, 'A fixture named "Digest" already exists.'));
      renderPanel();

      fireEvent.change(screen.getByLabelText(panel.nameLabel), { target: { value: "Digest" } });
      fireEvent.click(saveButton());

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith('A fixture named "Digest" already exists.'),
      );
      expect(toastSuccess).not.toHaveBeenCalled();
    });

    it("falls back to its own words when the failure has none", async () => {
      updateFixture.mockReturnValue(refused(500));
      renderPanel();

      fireEvent.change(screen.getByLabelText(panel.nameLabel), { target: { value: "Digest" } });
      fireEvent.click(saveButton());

      await waitFor(() => expect(toastError).toHaveBeenCalledWith(panel.saveFailed));
    });

    it("does not send a checklist for a PRD-review fixture", async () => {
      renderPanel(reviewFixture());

      fireEvent.change(screen.getByLabelText(panel.notesLabel, { exact: false }), {
        target: { value: "Still clean after the readiness change." },
      });
      fireEvent.click(saveButton());

      await waitFor(() => expect(updateFixture).toHaveBeenCalled());
      expect(updateFixture.mock.calls[0][0]).not.toHaveProperty("checklist");
    });
  });

  describe("a PRD-review fixture", () => {
    it("says what the critic should do instead of offering a checklist", () => {
      renderPanel(reviewFixture());

      expect(screen.getByText(panel.expectHeading)).toBeInTheDocument();
      expect(screen.getByText(panel.expectClean)).toBeInTheDocument();
      expect(screen.queryByText(strings.checklist.heading)).not.toBeInTheDocument();
    });

    it("names the readiness row a seeded defect must be caught through", () => {
      renderPanel(
        reviewFixture({
          payload: { prd: {} as never, expect: { blocking: true, via: "testPlanRepos" } },
        }),
      );

      expect(screen.getByText(panel.expectBlocking("testPlanRepos"))).toBeInTheDocument();
    });
  });

  describe("deleting", () => {
    it("asks first, and says what goes with it", () => {
      renderPanel();

      fireEvent.click(screen.getByRole("button", { name: panel.delete }));

      expect(screen.getByText(panel.deleteConfirmTitle)).toBeInTheDocument();
      expect(screen.getByText(panel.deleteConfirmBody)).toBeInTheDocument();
      expect(deleteFixture).not.toHaveBeenCalled();
    });

    it("can be backed out of", () => {
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: panel.delete }));
      fireEvent.click(screen.getByRole("button", { name: panel.cancel }));

      expect(screen.queryByText(panel.deleteConfirmTitle)).not.toBeInTheDocument();
      expect(deleteFixture).not.toHaveBeenCalled();
    });

    it("deletes on confirmation and closes the panel", async () => {
      const { onClose } = renderPanel();
      fireEvent.click(screen.getByRole("button", { name: panel.delete }));
      fireEvent.click(screen.getByRole("button", { name: panel.deleteConfirm }));

      await waitFor(() => expect(deleteFixture).toHaveBeenCalledWith("fix-1"));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(toastSuccess).toHaveBeenCalledWith(panel.deleted);
    });

    it("keeps the panel open and says so when the delete fails", async () => {
      deleteFixture.mockReturnValue(refused(500));
      const { onClose } = renderPanel();
      fireEvent.click(screen.getByRole("button", { name: panel.delete }));
      fireEvent.click(screen.getByRole("button", { name: panel.deleteConfirm }));

      await waitFor(() => expect(toastError).toHaveBeenCalledWith(panel.deleteFailed));
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it("keeps an unsaved draft when the list refetches under it, but follows a different fixture", () => {
    const { rerender } = render(
      <MemoryRouter>
        <FixtureSidePanel fixture={interviewFixture()} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(panel.nameLabel), { target: { value: "Half-typed" } });

    // The active switch in the table invalidated the list: same fixture, new object.
    rerender(
      <MemoryRouter>
        <FixtureSidePanel
          fixture={interviewFixture({ active: false, updatedAt: "2026-10-21T00:00:00.000Z" })}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(panel.nameLabel)).toHaveValue("Half-typed");

    rerender(
      <MemoryRouter>
        <FixtureSidePanel fixture={reviewFixture()} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(panel.nameLabel)).toHaveValue("Clean control");
  });
});
