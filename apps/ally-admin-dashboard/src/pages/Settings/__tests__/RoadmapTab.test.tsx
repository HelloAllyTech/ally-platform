import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicRoadmapItem } from "@api";

vi.mock("@components", () => ({
  cellTypes: {},
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} aria-label={rest["aria-label"]}>
      {children}
    </button>
  ),
  ActionConfirmationPopup: ({ isOpen, title, description, primaryButton, secondaryButton }: any) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <p>{description}</p>
        <button onClick={primaryButton.onClick}>{primaryButton.label}</button>
        <button onClick={secondaryButton.onClick}>{secondaryButton.label}</button>
      </div>
    ) : null,
}));
vi.mock("@components/organization-access-details/text-helpline/helpers", () => ({
  buildPublicLink: (path: string) => `https://app.example${path}`,
}));
vi.mock("@assets", () => ({
  Add: () => <svg />,
  ArrowDown: () => <svg />,
  ArrowUp: () => <svg />,
  Edit: () => <svg />,
  Launch: () => <svg />,
  Trash: () => <svg />,
}));
vi.mock("@ally-ui-mono/ui-shared", () => ({
  IconButton: ({ label, onClick, disabled }: any) => (
    <button aria-label={label} onClick={onClick} disabled={disabled} />
  ),
  InlineNotification: ({ title }: any) => <div role="alert">{title}</div>,
}));

const panelProps = vi.fn();
vi.mock("../RoadmapCardPanel", () => ({
  RoadmapCardPanel: (props: any) => {
    panelProps(props);
    return props.isOpen ? <div data-testid="card-panel" /> : null;
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

const ok = () => ({ unwrap: () => Promise.resolve({}) });
const updateItem = vi.fn(ok);
const reorderItems = vi.fn(ok);
const deleteItem = vi.fn(ok);
let queryResult: { data?: PublicRoadmapItem[]; isLoading: boolean; isError: boolean };

vi.mock("@api", () => ({
  useGetPublicRoadmapItemsQuery: () => queryResult,
  useUpdatePublicRoadmapItemMutation: () => [updateItem, { isLoading: false }],
  useReorderPublicRoadmapItemsMutation: () => [reorderItems, { isLoading: false }],
  useDeletePublicRoadmapItemMutation: () => [deleteItem, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { en } from "@constants";
// eslint-disable-next-line import/first
import { RoadmapTab } from "../RoadmapTab";

const strings = en.settings.roadmap;

const item = (overrides: Partial<PublicRoadmapItem>): PublicRoadmapItem => ({
  id: "x",
  title: "Card",
  description: "Text",
  note: null,
  category: "prepare",
  stage: "idea",
  sortOrder: 0,
  isPublic: true,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  ...overrides,
});

const voice = item({ id: "v", title: "Voice-first certification", sortOrder: 0 });
const refreshers = item({ id: "r", title: "Skill refreshers", sortOrder: 1, isPublic: false });
const helpline = item({
  id: "h",
  title: "Peer-Listener Helpline",
  category: "perform",
  stage: "lab",
  note: "Pilot in 3 months",
});

const label = (template: string, title: string) => template.replace("{title}", title);

describe("RoadmapTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryResult = { data: [voice, refreshers, helpline], isLoading: false, isError: false };
  });

  it("lists cards under their category and stage, marking hidden ones", () => {
    render(<RoadmapTab />);

    expect(screen.getByRole("heading", { level: 2, name: "Prepare" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Perform" })).toBeInTheDocument();
    expect(screen.getByText("Pilot in 3 months")).toBeInTheDocument();
    // Only the hidden card carries the tag; the visible one offers "Hide" instead.
    expect(screen.getAllByText(strings.hidden)).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: label(strings.showLabel, "Skill refreshers") }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(strings.emptyStage).length).toBeGreaterThan(0);
  });

  it("links to the public page on the learner app", () => {
    render(<RoadmapTab />);

    expect(screen.getByRole("link", { name: strings.viewPublicPage })).toHaveAttribute(
      "href",
      "https://app.example/blog/roadmap",
    );
  });

  it("hides a live card in one click", async () => {
    render(<RoadmapTab />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: label(strings.hideLabel, "Voice-first certification") }),
      );
    });

    expect(updateItem).toHaveBeenCalledWith({ id: "v", isPublic: false });
  });

  it("sends the whole cell, reordered, when a card moves", async () => {
    render(<RoadmapTab />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: label(strings.moveUp, "Skill refreshers") }),
      );
    });

    expect(reorderItems).toHaveBeenCalledWith(["r", "v"]);
    // The top card cannot move further up.
    expect(
      screen.getByRole("button", { name: label(strings.moveUp, "Voice-first certification") }),
    ).toBeDisabled();
  });

  it("asks before deleting, and points at Hide for a live card", async () => {
    render(<RoadmapTab />);

    fireEvent.click(
      screen.getByRole("button", { name: label(strings.delete, "Voice-first certification") }),
    );
    const dialog = screen.getByRole("dialog", { name: strings.deleteTitle });
    expect(dialog).toHaveTextContent(label(strings.deleteDescription, "Voice-first certification"));
    expect(deleteItem).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: strings.deleteConfirm }));
    });

    expect(deleteItem).toHaveBeenCalledWith("v");
    expect(toastSuccess).toHaveBeenCalledWith(strings.deleted);
  });

  it("does not claim a hidden card leaves the public page when it is deleted", () => {
    render(<RoadmapTab />);

    fireEvent.click(
      screen.getByRole("button", { name: label(strings.delete, "Skill refreshers") }),
    );

    expect(screen.getByRole("dialog")).toHaveTextContent(
      label(strings.deleteHiddenDescription, "Skill refreshers"),
    );
  });

  it("opens the panel pre-set to the stage whose + was pressed", () => {
    render(<RoadmapTab />);

    fireEvent.click(
      screen.getByRole("button", {
        name: strings.addToStage.replace("{category}", "Perform").replace("{stage}", "Beta"),
      }),
    );

    expect(screen.getByTestId("card-panel")).toBeInTheDocument();
    expect(panelProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ item: null, defaults: { category: "perform", stage: "beta" } }),
    );
  });

  it("reports a failed load rather than showing an empty roadmap", () => {
    queryResult = { data: undefined, isLoading: false, isError: true };
    render(<RoadmapTab />);

    expect(screen.getByRole("alert")).toHaveTextContent(strings.loadFailed);
    expect(screen.queryByText(strings.emptyStage)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: strings.addCard })).toBeDisabled();
  });

  it("tells the editor when a move fails", async () => {
    reorderItems.mockReturnValueOnce({ unwrap: () => Promise.reject(new Error("409")) });
    render(<RoadmapTab />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: label(strings.moveUp, "Skill refreshers") }),
      );
    });

    expect(toastError).toHaveBeenCalledWith(strings.moveFailed);
  });
});
