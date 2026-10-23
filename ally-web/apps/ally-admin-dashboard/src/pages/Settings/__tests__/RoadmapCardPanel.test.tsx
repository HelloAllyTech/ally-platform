import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicRoadmapItem } from "@api";

vi.mock("@components", () => ({
  cellTypes: {},
  EntitySidePanel: ({ isOpen, title, saveDisabled, saveDisabledReason, onSave, children }: any) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
        <button onClick={onSave} disabled={saveDisabled} title={saveDisabledReason}>
          Save
        </button>
      </div>
    ) : null,
  EntityField: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@ally-ui-mono/ui-shared", () => ({
  TextInput: ({ id, labelText, value, onChange, maxCount }: any) => (
    <input id={id} aria-label={labelText} value={value} onChange={onChange} maxLength={maxCount} />
  ),
  TextArea: ({ id, labelText, value, onChange, maxCount }: any) => (
    <textarea
      id={id}
      aria-label={labelText}
      value={value}
      onChange={onChange}
      maxLength={maxCount}
    />
  ),
  Select: ({ id, labelText, value, onChange, children }: any) => (
    <select id={id} aria-label={labelText} value={value} onChange={onChange}>
      {children}
    </select>
  ),
  SelectItem: ({ value, text }: any) => <option value={value}>{text}</option>,
  CarbonToggle: ({ id, labelText, toggled, onToggle }: any) => (
    <input
      id={id}
      type="checkbox"
      role="switch"
      aria-label={labelText}
      checked={toggled}
      onChange={e => onToggle(e.target.checked)}
    />
  ),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

const createItem = vi.fn(() => ({ unwrap: () => Promise.resolve({}) }));
const updateItem = vi.fn(() => ({ unwrap: () => Promise.resolve({}) }));
vi.mock("@api", () => ({
  useCreatePublicRoadmapItemMutation: () => [createItem, { isLoading: false }],
  useUpdatePublicRoadmapItemMutation: () => [updateItem, { isLoading: false }],
}));

// eslint-disable-next-line import/first
import { en } from "@constants";
// eslint-disable-next-line import/first
import { RoadmapCardPanel } from "../RoadmapCardPanel";

const strings = en.settings.roadmap;

const existing: PublicRoadmapItem = {
  id: "c1",
  title: "Learner App",
  description: "A vertical, voice-first LMS.",
  note: "Current priority",
  category: "prepare",
  stage: "beta",
  sortOrder: 0,
  isPublic: true,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};

const type = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });

const save = () =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });

describe("RoadmapCardPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts a new card in the stage it was opened from, visible", () => {
    render(
      <RoadmapCardPanel
        isOpen
        item={null}
        defaults={{ category: "perform", stage: "lab" }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: strings.addPanelTitle })).toBeInTheDocument();
    expect(screen.getByLabelText(strings.categoryLabel)).toHaveValue("perform");
    expect(screen.getByLabelText(strings.stageLabel)).toHaveValue("lab");
    expect(screen.getByRole("switch", { name: strings.visibleLabel })).toBeChecked();
  });

  it("will not save without a title and says why", () => {
    render(
      <RoadmapCardPanel
        isOpen
        item={null}
        defaults={{ category: "prepare", stage: "idea" }}
        onClose={vi.fn()}
      />,
    );
    type(strings.descriptionLabel, "Something");

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", strings.titleRequired);
  });

  it("creates a trimmed card, a blank note sent as none, and says it is live", async () => {
    const onClose = vi.fn();
    render(
      <RoadmapCardPanel
        isOpen
        item={null}
        defaults={{ category: "perform", stage: "idea" }}
        onClose={onClose}
      />,
    );
    type(strings.titleLabel, "  Field Companion ");
    type(strings.descriptionLabel, " Voice guidance on home visits. ");
    type(strings.noteLabel, "   ");

    await save();

    expect(createItem).toHaveBeenCalledWith({
      title: "Field Companion",
      description: "Voice guidance on home visits.",
      note: null,
      category: "perform",
      stage: "idea",
      isPublic: true,
    });
    expect(toastSuccess).toHaveBeenCalledWith(strings.savedLive);
    expect(onClose).toHaveBeenCalled();
  });

  it("edits the card it was opened on, and says when it is now hidden", async () => {
    render(
      <RoadmapCardPanel
        isOpen
        item={existing}
        defaults={{ category: "prepare", stage: "beta" }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(strings.noteLabel)).toHaveValue("Current priority");

    fireEvent.change(screen.getByLabelText(strings.stageLabel), { target: { value: "released" } });
    fireEvent.click(screen.getByRole("switch", { name: strings.visibleLabel }));
    await save();

    expect(updateItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1", stage: "released", isPublic: false }),
    );
    expect(createItem).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith(strings.savedHidden);
  });

  it("keeps the panel open and reports a failed save", async () => {
    updateItem.mockReturnValueOnce({ unwrap: () => Promise.reject(new Error("500")) });
    const onClose = vi.fn();
    render(
      <RoadmapCardPanel
        isOpen
        item={existing}
        defaults={{ category: "prepare", stage: "beta" }}
        onClose={onClose}
      />,
    );

    await save();

    expect(toastError).toHaveBeenCalledWith(strings.saveFailed);
    expect(onClose).not.toHaveBeenCalled();
  });
});
